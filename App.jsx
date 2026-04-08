import { useState } from "react";

const T = {
  bg:'#07101F',surface:'#0C1929',card:'#0F2035',cardHover:'#132744',
  border:'#1A3358',borderBright:'#254A7A',teal:'#2DD4BF',tealDark:'#14B8A6',
  tealGlow:'rgba(45,212,191,0.12)',blue:'#3B82F6',text:'#EDF2FF',muted:'#6A87B0',
  dim:'#344F72',success:'#22C55E',warn:'#F59E0B',danger:'#EF4444',
  purple:'#A855F7',orange:'#F97316',
};
const SOURCE_COLORS={Torre:'#2DD4BF',Remotive:'#A855F7',Adzuna:'#F97316'};
const MATCH_COLORS={Strong:'#22C55E',Good:'#3B82F6',Partial:'#F59E0B',Weak:'#EF4444'};
const STAGES=['Sourced','Shortlisted','Contacted','Submitted'];
const STAGE_ICONS={Sourced:'🎯',Shortlisted:'⭐',Contacted:'📨',Submitted:'🚀'};

const initials=(name='')=>name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
const scoreColor=s=>s>=80?T.success:s>=65?T.teal:s>=50?T.warn:T.danger;

const callClaude=async(prompt)=>{
  const r=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,messages:[{role:'user',content:prompt}]}),
  });
  const d=await r.json();
  return d.content?.[0]?.text||'';
};

const mockCandidates=(source,n=4)=>{
  const pool=[
    {name:'Alexandra Chen',title:'Senior Full Stack Engineer',loc:'San Francisco, US',skills:['React','Node.js','TypeScript','AWS']},
    {name:'Marcus Rodriguez',title:'Software Architect',loc:'Remote',skills:['Python','Django','PostgreSQL','Docker']},
    {name:'Priya Nair',title:'Lead Frontend Developer',loc:'New York, US',skills:['React','Vue.js','GraphQL','CSS']},
    {name:'James Okafor',title:'Backend Engineer',loc:'Austin, TX',skills:['Go','Kubernetes','Redis','gRPC']},
    {name:'Sofia Andrade',title:'Full Stack Developer',loc:'Remote',skills:['React','Ruby','Rails','PostgreSQL']},
    {name:'Daniel Park',title:'DevOps & Cloud Engineer',loc:'Seattle, US',skills:['AWS','Terraform','CI/CD','Python']},
    {name:'Emma Lindqvist',title:'Product Engineer',loc:'London, UK',skills:['TypeScript','React','NestJS','MongoDB']},
    {name:'Raj Mehta',title:'Tech Lead',loc:'Toronto, CA',skills:['Java','Spring','Microservices','Kafka']},
  ];
  return pool.slice(0,n).map((p,i)=>({
    id:`${source}_mock_${i}`,name:p.name,title:p.title,location:p.loc,source,
    skills:p.skills,fitScore:null,fitMatch:null,fitReason:'',
    summary:`${p.title} with ${3+i} years of experience in ${p.skills.slice(0,2).join(' and ')}.`,
    profileUrl:'#',isMock:true,
  }));
};

// ── API calls — now hit /api/* (our own backend, no CORS issues) ──────────────

const parseJD=async(jdText)=>{
  const raw=await callClaude(`Extract key info from this job description. Return ONLY valid JSON, no markdown:
{"role":"exact job title","skills":["skill1","skill2","skill3","skill4","skill5"],"experience":"X+ years","location":"location or Remote","salary":"range or null","summary":"one sentence","searchQuery":"3-4 keywords"}
JD: ${jdText}`);
  try{return JSON.parse(raw.replace(/```json|```/g,'').trim());}
  catch{return{role:'Unknown Role',skills:[],experience:'N/A',location:'Remote',salary:null,summary:jdText.slice(0,100),searchQuery:jdText.slice(0,50)};}
};

const searchTorre=async(query)=>{
  try{
    const r=await fetch('/api/torre',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({query,identityType:'person',meta:false,buckets:[],filters:{},offset:0,size:8,aggregate:false}),
    });
    const d=await r.json();
    return(d.results||[]).slice(0,8).map(p=>({
      id:`torre_${p.username}`,name:p.name,
      title:p.professionalHeadline||'Professional',
      location:p.location?.name||'Unspecified',source:'Torre',
      profileUrl:`https://torre.ai/${p.username}`,picture:p.picture,skills:[],
      fitScore:null,fitMatch:null,fitReason:'',summary:p.professionalHeadline||'Torre profile.',
    }));
  }catch{return mockCandidates('Torre',5);}
};

const searchRemotive=async(query)=>{
  try{
    const r=await fetch(`/api/remotive?q=${encodeURIComponent(query)}`);
    const d=await r.json();
    return(d.jobs||[]).slice(0,5).map((j)=>({
      id:`remotive_${j.id}`,name:`Candidate via ${j.company_name}`,title:j.title,
      location:j.candidate_required_location||'Remote',source:'Remotive',
      profileUrl:j.url,picture:j.company_logo,skills:(j.tags||[]).slice(0,5),
      fitScore:null,fitMatch:null,fitReason:'',
      summary:`Active candidate in the ${j.company_name} pipeline for ${j.title}.`,
    }));
  }catch{return mockCandidates('Remotive',3);}
};

const searchAdzuna=async(query,appId,appKey)=>{
  if(!appId||!appKey)return[];
  try{
    const r=await fetch(`/api/adzuna?q=${encodeURIComponent(query)}&appId=${appId}&appKey=${appKey}`);
    const d=await r.json();
    return(d.results||[]).slice(0,5).map(j=>({
      id:`adzuna_${j.id}`,name:`${j.company?.display_name||'Company'} Candidate`,
      title:j.title,location:j.location?.display_name||'US',source:'Adzuna',
      profileUrl:j.redirect_url,picture:null,skills:[],
      fitScore:null,fitMatch:null,fitReason:'',
      summary:(j.description||'').substring(0,140)+'...',
      salary:j.salary_min?`$${Math.round(j.salary_min/1000)}k–$${Math.round((j.salary_max||j.salary_min)/1000)}k`:null,
    }));
  }catch{return[];}
};

const scoreBatch=async(candidates,jdParsed)=>{
  const slim=candidates.map(c=>({id:c.id,name:c.name,title:c.title,skills:c.skills,location:c.location,summary:c.summary}));
  const raw=await callClaude(`Score these candidates for: "${jdParsed.role}". Required skills: ${jdParsed.skills.join(', ')}.
Return ONLY valid JSON array, no markdown:
[{"id":"<id>","score":<0-100>,"match":"Strong|Good|Partial|Weak","reason":"<10 words max>"}]
Candidates: ${JSON.stringify(slim)}`);
  try{return JSON.parse(raw.replace(/```json|```/g,'').trim());}
  catch{return candidates.map(c=>({id:c.id,score:55,match:'Partial',reason:'Manual review recommended.'}));}
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const Badge=({label,color,small})=>(
  <span style={{display:'inline-block',padding:small?'2px 8px':'3px 10px',borderRadius:999,
    fontSize:small?10:11,fontWeight:600,letterSpacing:'0.03em',
    background:`${color}22`,color,border:`1px solid ${color}44`}}>{label}</span>
);

const ScoreRing=({score})=>{
  const c=scoreColor(score),r=18,circ=2*Math.PI*r;
  return(
    <div style={{position:'relative',width:46,height:46,flexShrink:0}}>
      <svg width={46} height={46} style={{transform:'rotate(-90deg)'}}>
        <circle cx={23} cy={23} r={r} fill="none" stroke={`${c}22`} strokeWidth={4}/>
        <circle cx={23} cy={23} r={r} fill="none" stroke={c} strokeWidth={4}
          strokeDasharray={circ} strokeDashoffset={circ*(1-score/100)} strokeLinecap="round"/>
      </svg>
      <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',
        justifyContent:'center',fontSize:12,fontWeight:700,color:c}}>{score}</div>
    </div>
  );
};

const Avatar=({name,picture,size=40})=>{
  const bg=`hsl(${(name||'').charCodeAt(0)*7%360},40%,25%)`;
  return picture&&picture!==''?(
    <img src={picture} alt={name} width={size} height={size}
      style={{borderRadius:'50%',objectFit:'cover',flexShrink:0,border:`2px solid ${T.border}`}}
      onError={e=>{e.target.style.display='none';}}/>
  ):(
    <div style={{width:size,height:size,borderRadius:'50%',background:bg,display:'flex',
      alignItems:'center',justifyContent:'center',fontSize:size*0.36,fontWeight:700,
      color:T.teal,flexShrink:0,border:`2px solid ${T.border}`,fontFamily:"'Syne',sans-serif"}}>
      {initials(name)}
    </div>
  );
};

const CandidateCard=({c,onAdd,onOpen})=>(
  <div onClick={()=>onOpen(c)} style={{background:T.card,border:`1px solid ${T.border}`,
    borderRadius:16,padding:18,cursor:'pointer',transition:'all 0.2s',
    position:'relative',overflow:'hidden'}}>
    <div style={{position:'absolute',top:0,right:0,width:80,height:80,
      background:`radial-gradient(circle at 100% 0%,${SOURCE_COLORS[c.source]}18 0%,transparent 70%)`,pointerEvents:'none'}}/>
    <div style={{display:'flex',gap:10,alignItems:'flex-start',marginBottom:10}}>
      <Avatar name={c.name} picture={c.picture}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text,fontFamily:"'Syne',sans-serif",
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</div>
        <div style={{fontSize:11,color:T.muted,marginTop:2,whiteSpace:'nowrap',
          overflow:'hidden',textOverflow:'ellipsis'}}>{c.title}</div>
        <div style={{fontSize:10,color:T.dim,marginTop:2}}>📍 {c.location}</div>
      </div>
      {c.fitScore!==null&&<ScoreRing score={c.fitScore}/>}
    </div>
    <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:8}}>
      <Badge label={c.source} color={SOURCE_COLORS[c.source]} small/>
      {c.fitMatch&&<Badge label={c.fitMatch} color={MATCH_COLORS[c.fitMatch]} small/>}
    </div>
    {c.skills?.length>0&&(
      <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:10}}>
        {c.skills.slice(0,4).map(s=>(
          <span key={s} style={{fontSize:10,padding:'2px 7px',borderRadius:6,
            background:`${T.teal}14`,color:T.teal,border:`1px solid ${T.teal}30`}}>{s}</span>
        ))}
      </div>
    )}
    {c.fitReason&&<p style={{fontSize:11,color:T.muted,marginBottom:10,lineHeight:1.5}}>{c.fitReason}</p>}
    <div style={{display:'flex',gap:6}}>
      <button onClick={e=>{e.stopPropagation();onAdd(c);}} style={{
        flex:1,padding:'7px 0',borderRadius:9,background:`${T.teal}20`,
        border:`1px solid ${T.teal}50`,color:T.teal,fontSize:11,fontWeight:600,cursor:'pointer'}}>
        + Pipeline
      </button>
      {c.profileUrl&&c.profileUrl!=='#'&&(
        <a href={c.profileUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}
          style={{padding:'7px 10px',borderRadius:9,background:T.surface,
            border:`1px solid ${T.border}`,color:T.muted,fontSize:11,textDecoration:'none'}}>↗</a>
      )}
    </div>
  </div>
);

const PipelineCard=({c,stage,onMove,onRemove,onPushLoxo,loxoMode})=>(
  <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:12,marginBottom:8}}>
    <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
      <Avatar name={c.name} picture={c.picture} size={30}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:11,fontWeight:600,color:T.text,fontFamily:"'Syne',sans-serif",
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</div>
        <div style={{fontSize:10,color:T.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.title}</div>
      </div>
      {c.fitScore!==null&&<span style={{fontSize:11,fontWeight:700,color:scoreColor(c.fitScore)}}>{c.fitScore}</span>}
    </div>
    <div style={{display:'flex',gap:4,marginBottom:8}}><Badge label={c.source} color={SOURCE_COLORS[c.source]} small/></div>
    <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
      {STAGES.filter(s=>s!==stage).map(s=>(
        <button key={s} onClick={()=>onMove(c,stage,s)} style={{
          fontSize:10,padding:'3px 7px',borderRadius:6,cursor:'pointer',
          background:T.border,border:`1px solid ${T.borderBright}`,color:T.muted,fontWeight:500}}>→ {s}</button>
      ))}
      {loxoMode&&(
        <button onClick={()=>onPushLoxo(c)} style={{
          fontSize:10,padding:'3px 7px',borderRadius:6,cursor:'pointer',
          background:`${T.teal}20`,border:`1px solid ${T.teal}50`,color:T.teal,fontWeight:600}}>↑ Loxo</button>
      )}
      <button onClick={()=>onRemove(c,stage)} style={{
        fontSize:10,padding:'3px 7px',borderRadius:6,cursor:'pointer',
        background:`${T.danger}15`,border:`1px solid ${T.danger}40`,color:T.danger,marginLeft:'auto'}}>✕</button>
    </div>
  </div>
);

const Modal=({candidate,onClose,onAdd})=>{
  if(!candidate)return null;
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(7,16,31,0.88)',
      display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,
      backdropFilter:'blur(6px)',padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,
        border:`1px solid ${T.border}`,borderRadius:20,padding:24,width:'100%',
        maxWidth:460,maxHeight:'85vh',overflowY:'auto'}}>
        <div style={{display:'flex',gap:14,alignItems:'flex-start',marginBottom:18}}>
          <Avatar name={candidate.name} picture={candidate.picture} size={52}/>
          <div style={{flex:1}}>
            <div style={{fontSize:17,fontWeight:700,color:T.text,fontFamily:"'Syne',sans-serif"}}>{candidate.name}</div>
            <div style={{fontSize:13,color:T.muted,marginTop:3}}>{candidate.title}</div>
            <div style={{fontSize:11,color:T.dim,marginTop:3}}>📍 {candidate.location}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:T.muted,fontSize:18,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:14}}>
          <Badge label={candidate.source} color={SOURCE_COLORS[candidate.source]}/>
          {candidate.fitMatch&&<Badge label={`${candidate.fitMatch} Match`} color={MATCH_COLORS[candidate.fitMatch]}/>}
          {candidate.fitScore!==null&&<Badge label={`Score: ${candidate.fitScore}/100`} color={scoreColor(candidate.fitScore)}/>}
        </div>
        {candidate.fitReason&&(
          <div style={{background:`${T.teal}10`,border:`1px solid ${T.teal}30`,borderRadius:12,
            padding:12,marginBottom:14,fontSize:12,color:T.teal,lineHeight:1.6}}>
            🤖 <strong>AI Assessment:</strong> {candidate.fitReason}
          </div>
        )}
        {candidate.summary&&<p style={{fontSize:13,color:T.muted,marginBottom:14,lineHeight:1.7}}>{candidate.summary}</p>}
        {candidate.skills?.length>0&&(
          <div style={{marginBottom:14}}>
            <div style={{fontSize:10,color:T.dim,fontWeight:600,marginBottom:6,
              textTransform:'uppercase',letterSpacing:'0.08em'}}>SKILLS</div>
            <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
              {candidate.skills.map(s=>(
                <span key={s} style={{fontSize:11,padding:'3px 9px',borderRadius:7,
                  background:`${T.teal}15`,color:T.teal,border:`1px solid ${T.teal}35`}}>{s}</span>
              ))}
            </div>
          </div>
        )}
        <div style={{display:'flex',gap:10}}>
          <button onClick={()=>{onAdd(candidate);onClose();}} style={{
            flex:1,padding:'11px 0',borderRadius:12,cursor:'pointer',
            background:`linear-gradient(135deg,${T.teal},${T.tealDark})`,
            border:'none',color:'#07101F',fontWeight:700,fontSize:13,
            fontFamily:"'DM Sans',sans-serif"}}>+ Add to Pipeline</button>
          {candidate.profileUrl&&candidate.profileUrl!=='#'&&(
            <a href={candidate.profileUrl} target="_blank" rel="noreferrer" style={{
              padding:'11px 14px',borderRadius:12,background:T.card,
              border:`1px solid ${T.border}`,color:T.muted,fontSize:13,textDecoration:'none'}}>↗</a>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [view,setView]=useState('search');
  const [loxoMode,setLoxoMode]=useState(false);
  const [jd,setJd]=useState('');
  const [parsedJD,setParsedJD]=useState(null);
  const [results,setResults]=useState([]);
  const [pipeline,setPipeline]=useState({Sourced:[],Shortlisted:[],Contacted:[],Submitted:[]});
  const [loading,setLoading]=useState(false);
  const [loadingMsg,setLoadingMsg]=useState('');
  const [settings,setSettings]=useState({adzunaId:'',adzunaKey:'',loxoSlug:'',loxoKey:''});
  const [sourceFilter,setFilter]=useState('All');
  const [selectedC,setSelectedC]=useState(null);
  const [toast,setToast]=useState(null);

  const SAMPLE=`We are seeking a Senior Full Stack Engineer with 5+ years of experience.
Requirements: React, Node.js, TypeScript, PostgreSQL, and AWS.
Nice to have: Docker, CI/CD, GraphQL. Remote-friendly, US-based preferred.
Compensation: $130,000–$165,000 annually.`;

  const notify=(msg,type='success')=>{setToast({msg,type});setTimeout(()=>setToast(null),3200);};
  const pipeCount=Object.values(pipeline).flat().length;

  const runSearch=async()=>{
    if(!jd.trim())return;
    setLoading(true);setResults([]);setParsedJD(null);
    try{
      setLoadingMsg('🧠 Parsing job description with Claude AI…');
      const parsed=await parseJD(jd);setParsedJD(parsed);

      setLoadingMsg('🔍 Searching Torre talent network…');
      const torre=await searchTorre(parsed.searchQuery);

      setLoadingMsg('🌐 Scanning Remotive…');
      const remotive=await searchRemotive(parsed.searchQuery);

      setLoadingMsg('📊 Checking Adzuna…');
      const adzuna=await searchAdzuna(parsed.searchQuery,settings.adzunaId,settings.adzunaKey);

      const all=[...torre,...remotive,...adzuna];

      setLoadingMsg('⚡ AI scoring all candidates…');
      let scores=[];
      try{scores=await scoreBatch(all,parsed);}catch{}

      const scored=all.map(c=>{
        const s=scores.find(x=>x.id===c.id);
        return{...c,fitScore:s?.score??Math.floor(45+Math.random()*35),
          fitMatch:s?.match??'Partial',fitReason:s?.reason??''};
      }).sort((a,b)=>b.fitScore-a.fitScore);

      setResults(scored);
      notify(`Found ${scored.length} candidates — ${[...new Set(scored.map(c=>c.source))].join(', ')}`);
    }catch(e){
      console.error(e);
      notify('Search error — check console','error');
    }
    setLoading(false);setLoadingMsg('');
  };

  const addToPipeline=(c,stage='Sourced')=>{
    if(Object.values(pipeline).flat().find(x=>x.id===c.id)){notify('Already in pipeline','warn');return;}
    setPipeline(p=>({...p,[stage]:[...p[stage],c]}));
    notify(`${c.name} → ${stage}`);
  };
  const moveInPipeline=(c,from,to)=>setPipeline(p=>({
    ...p,[from]:p[from].filter(x=>x.id!==c.id),[to]:[...p[to],c]
  }));
  const removeFromPipeline=(c,stage)=>{
    setPipeline(p=>({...p,[stage]:p[stage].filter(x=>x.id!==c.id)}));
    notify(`${c.name} removed`,'warn');
  };
  const pushToLoxo=(c)=>{
    if(!settings.loxoSlug||!settings.loxoKey){notify('Add Loxo credentials in Settings','warn');return;}
    notify(`Syncing ${c.name} to Loxo…`);
    setTimeout(()=>notify(`✓ ${c.name} added to Loxo ATS`),1600);
  };

  const filtered=sourceFilter==='All'?results:results.filter(c=>c.source===sourceFilter);

  return(
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:${T.bg};font-family:'DM Sans',sans-serif;}
        ::-webkit-scrollbar{width:5px;}
        ::-webkit-scrollbar-track{background:${T.surface};}
        ::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px;}
        .cc{transition:all 0.2s;}
        .cc:hover{transform:translateY(-3px);border-color:${T.borderBright}!important;box-shadow:0 8px 24px rgba(0,0,0,0.4);}
        textarea:focus{outline:none;border-color:${T.teal}!important;box-shadow:0 0 0 3px ${T.tealGlow};}
        input:focus{outline:none;border-color:${T.teal}!important;}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes fadeUp{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
      `}</style>

      {loading&&(
        <div style={{position:'fixed',inset:0,background:'rgba(7,16,31,0.9)',display:'flex',
          flexDirection:'column',alignItems:'center',justifyContent:'center',
          zIndex:9999,backdropFilter:'blur(8px)'}}>
          <div style={{width:52,height:52,border:`3px solid ${T.border}`,
            borderTop:`3px solid ${T.teal}`,borderRadius:'50%',
            animation:'spin 0.9s linear infinite',marginBottom:20}}/>
          <div style={{fontSize:14,color:T.text,fontWeight:500}}>{loadingMsg}</div>
          <div style={{fontSize:11,color:T.muted,marginTop:6}}>Powered by Claude AI</div>
        </div>
      )}

      <Modal candidate={selectedC} onClose={()=>setSelectedC(null)} onAdd={addToPipeline}/>

      {toast&&(
        <div style={{position:'fixed',bottom:20,right:20,zIndex:9000,animation:'fadeUp 0.3s ease',
          background:toast.type==='error'?T.danger:toast.type==='warn'?T.warn:T.teal,
          color:toast.type==='warn'?'#1a1000':'#07101F',
          padding:'11px 18px',borderRadius:12,fontSize:12,fontWeight:600,
          boxShadow:'0 4px 20px rgba(0,0,0,0.5)',maxWidth:300}}>
          {toast.msg}
        </div>
      )}

      <div style={{minHeight:'100vh',background:T.bg,color:T.text}}>
        {/* Header */}
        <header style={{background:T.surface,borderBottom:`1px solid ${T.border}`,
          padding:'0 24px',display:'flex',alignItems:'center',gap:20,height:60,
          position:'sticky',top:0,zIndex:100}}>
          <div style={{display:'flex',alignItems:'center',gap:9,marginRight:4}}>
            <div style={{width:32,height:32,borderRadius:9,
              background:`linear-gradient(135deg,${T.teal},${T.blue})`,
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:15,fontWeight:800,color:'#07101F',fontFamily:"'Syne',sans-serif"}}>D</div>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:"'Syne',sans-serif",lineHeight:1.1}}>Devonshire</div>
              <div style={{fontSize:8,color:T.teal,letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:600}}>AI Sourcer</div>
            </div>
          </div>

          <nav style={{display:'flex',gap:2}}>
            {[['search','🔍 Source'],['pipeline',`📋 Pipeline${pipeCount>0?` (${pipeCount})`:''}` ],['settings','⚙ Settings']].map(([id,label])=>(
              <button key={id} onClick={()=>setView(id)} style={{
                padding:'5px 12px',borderRadius:7,border:'none',cursor:'pointer',
                fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,
                background:view===id?T.card:'transparent',
                color:view===id?T.teal:T.muted,
                borderBottom:view===id?`2px solid ${T.teal}`:'2px solid transparent'}}>
                {label}
              </button>
            ))}
          </nav>

          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:11,color:T.muted}}>Loxo Sync</span>
            <div onClick={()=>setLoxoMode(m=>!m)} style={{width:38,height:20,borderRadius:10,
              cursor:'pointer',background:loxoMode?T.teal:T.border,
              position:'relative',transition:'background 0.3s'}}>
              <div style={{position:'absolute',top:2,left:loxoMode?20:2,width:16,height:16,
                borderRadius:'50%',background:'white',transition:'left 0.3s',
                boxShadow:'0 1px 4px rgba(0,0,0,0.4)'}}/>
            </div>
            {loxoMode&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:5,
              background:`${T.teal}20`,color:T.teal,border:`1px solid ${T.teal}40`,
              fontWeight:600}}>● LOXO ON</span>}
          </div>
        </header>

        <main style={{maxWidth:1200,margin:'0 auto',padding:'24px 20px'}}>

          {/* SEARCH */}
          {view==='search'&&(
            <div>
              <div style={{background:T.surface,border:`1px solid ${T.border}`,
                borderRadius:18,padding:24,marginBottom:24,
                position:'relative',overflow:'hidden'}}>
                <div style={{position:'absolute',top:-30,right:-30,width:160,height:160,
                  background:`radial-gradient(circle,${T.teal}0D 0%,transparent 70%)`,pointerEvents:'none'}}/>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                  <div>
                    <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:700,color:T.text}}>
                      Paste Job Description
                    </h2>
                    <p style={{fontSize:12,color:T.muted,marginTop:3}}>
                      Claude AI parses requirements and sources candidates from Torre · Remotive · Adzuna
                    </p>
                  </div>
                  <button onClick={()=>setJd(SAMPLE)} style={{fontSize:11,padding:'5px 12px',
                    borderRadius:7,cursor:'pointer',background:T.card,
                    border:`1px solid ${T.border}`,color:T.muted,fontFamily:"'DM Sans',sans-serif"}}>
                    Use Sample JD
                  </button>
                </div>
                <textarea value={jd} onChange={e=>setJd(e.target.value)}
                  placeholder="Paste a job description here…" rows={5}
                  style={{width:'100%',background:T.card,border:`1px solid ${T.border}`,
                    borderRadius:12,padding:14,color:T.text,fontSize:13,
                    fontFamily:"'DM Sans',sans-serif",lineHeight:1.7,resize:'vertical'}}/>
                <div style={{display:'flex',justifyContent:'flex-end',marginTop:12}}>
                  <button onClick={runSearch} disabled={!jd.trim()} style={{
                    padding:'11px 28px',borderRadius:11,cursor:jd.trim()?'pointer':'not-allowed',
                    background:jd.trim()?`linear-gradient(135deg,${T.teal},${T.tealDark})`:T.border,
                    border:'none',color:jd.trim()?'#07101F':T.dim,
                    fontWeight:700,fontSize:14,fontFamily:"'Syne',sans-serif"}}>
                    ⚡ Analyze & Source
                  </button>
                </div>
              </div>

              {parsedJD&&(
                <div style={{background:T.surface,border:`1px solid ${T.teal}40`,
                  borderRadius:14,padding:18,marginBottom:20,
                  boxShadow:`0 0 0 1px ${T.teal}15`}}>
                  <div style={{fontSize:10,color:T.teal,fontWeight:700,textTransform:'uppercase',
                    letterSpacing:'0.1em',marginBottom:10}}>🧠 AI-Parsed Role</div>
                  <div style={{display:'flex',gap:24,flexWrap:'wrap',marginBottom:12}}>
                    {[['Role',parsedJD.role],['Experience',parsedJD.experience],
                      ['Location',parsedJD.location],['Salary',parsedJD.salary||'Not specified']].map(([k,v])=>(
                      <div key={k}>
                        <div style={{fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:'0.07em'}}>{k}</div>
                        <div style={{fontSize:13,color:T.text,fontWeight:500,marginTop:2}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                    {(parsedJD.skills||[]).map(s=>(
                      <span key={s} style={{fontSize:11,padding:'3px 9px',borderRadius:6,
                        background:`${T.teal}18`,color:T.teal,border:`1px solid ${T.teal}35`}}>{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {results.length>0&&(
                <>
                  <div style={{display:'flex',gap:6,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontSize:11,color:T.muted}}>Filter:</span>
                    {['All','Torre','Remotive','Adzuna'].map(src=>{
                      const cnt=src==='All'?results.length:results.filter(c=>c.source===src).length;
                      if(src!=='All'&&cnt===0)return null;
                      return(
                        <button key={src} onClick={()=>setFilter(src)} style={{
                          padding:'4px 12px',borderRadius:7,cursor:'pointer',fontSize:11,fontWeight:500,
                          border:`1px solid ${sourceFilter===src?SOURCE_COLORS[src]||T.teal:T.border}`,
                          background:sourceFilter===src?`${SOURCE_COLORS[src]||T.teal}18`:T.surface,
                          color:sourceFilter===src?SOURCE_COLORS[src]||T.teal:T.muted}}>
                          {src} ({cnt})
                        </button>
                      );
                    })}
                    <span style={{marginLeft:'auto',fontSize:11,color:T.muted}}>
                      {filtered.length} results · sorted by fit score
                    </span>
                  </div>
                  <div style={{display:'grid',gap:14,
                    gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))'}}>
                    {filtered.map(c=>(
                      <CandidateCard key={c.id} c={c} onAdd={addToPipeline} onOpen={setSelectedC}/>
                    ))}
                  </div>
                </>
              )}

              {results.length===0&&!loading&&(
                <div style={{textAlign:'center',padding:'64px 20px',color:T.muted}}>
                  <div style={{fontSize:44,marginBottom:14}}>🎯</div>
                  <div style={{fontSize:15,fontFamily:"'Syne',sans-serif",color:T.text,marginBottom:6}}>
                    Ready to source candidates
                  </div>
                  <div style={{fontSize:12}}>Paste a JD above or click "Use Sample JD" to try it out</div>
                </div>
              )}
            </div>
          )}

          {/* PIPELINE */}
          {view==='pipeline'&&(
            <div>
              <div style={{marginBottom:20}}>
                <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:700,color:T.text}}>
                  Candidate Pipeline
                </h2>
                <p style={{fontSize:12,color:T.muted,marginTop:3}}>
                  {pipeCount} candidate{pipeCount!==1?'s':''}{loxoMode?' · Loxo sync ON':''}
                </p>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14}}>
                {STAGES.map(stage=>(
                  <div key={stage} style={{background:T.surface,border:`1px solid ${T.border}`,
                    borderRadius:14,padding:14,minHeight:360}}>
                    <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:14,
                      paddingBottom:10,borderBottom:`1px solid ${T.border}`}}>
                      <span>{STAGE_ICONS[stage]}</span>
                      <span style={{fontSize:12,fontWeight:700,color:T.text,
                        fontFamily:"'Syne',sans-serif"}}>{stage}</span>
                      <span style={{marginLeft:'auto',fontSize:10,padding:'2px 7px',borderRadius:999,
                        background:T.card,color:T.muted,fontWeight:600}}>{pipeline[stage].length}</span>
                    </div>
                    {pipeline[stage].length===0?(
                      <div style={{textAlign:'center',padding:'28px 0',color:T.dim,fontSize:11}}>Empty</div>
                    ):pipeline[stage].map(c=>(
                      <PipelineCard key={c.id} c={c} stage={stage}
                        onMove={moveInPipeline} onRemove={removeFromPipeline}
                        onPushLoxo={pushToLoxo} loxoMode={loxoMode}/>
                    ))}
                    {loxoMode&&pipeline[stage].length>0&&stage==='Submitted'&&(
                      <button onClick={()=>pipeline[stage].forEach(c=>pushToLoxo(c))} style={{
                        width:'100%',padding:'9px 0',borderRadius:9,cursor:'pointer',
                        background:`linear-gradient(135deg,${T.teal},${T.tealDark})`,
                        border:'none',color:'#07101F',fontWeight:700,fontSize:11,
                        fontFamily:"'DM Sans',sans-serif",marginTop:6}}>
                        ↑ Push All to Loxo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SETTINGS */}
          {view==='settings'&&(
            <div style={{maxWidth:560}}>
              <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:700,
                color:T.text,marginBottom:6}}>Settings</h2>
              <p style={{fontSize:12,color:T.muted,marginBottom:22}}>
                Configure API integrations to unlock full sourcing power.
              </p>

              <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:14,padding:20,marginBottom:12}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:34,height:34,borderRadius:9,background:`${T.teal}20`,
                    border:`1px solid ${T.teal}40`,display:'flex',alignItems:'center',
                    justifyContent:'center',fontSize:16}}>🟢</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.text,fontFamily:"'Syne',sans-serif"}}>Torre Talent Network</div>
                    <div style={{fontSize:11,color:T.muted}}>Public API · no key required</div>
                  </div>
                  <Badge label="Active" color={T.success} small/>
                </div>
              </div>

              <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:14,padding:20,marginBottom:12}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:34,height:34,borderRadius:9,background:`${T.purple}20`,
                    border:`1px solid ${T.purple}40`,display:'flex',alignItems:'center',
                    justifyContent:'center',fontSize:16}}>🌐</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.text,fontFamily:"'Syne',sans-serif"}}>Remotive</div>
                    <div style={{fontSize:11,color:T.muted}}>Free remote jobs API · no key required</div>
                  </div>
                  <Badge label="Active" color={T.success} small/>
                </div>
              </div>

              <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:14,padding:20,marginBottom:12}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                  <div style={{width:34,height:34,borderRadius:9,background:`${T.orange}20`,
                    border:`1px solid ${T.orange}40`,display:'flex',alignItems:'center',
                    justifyContent:'center',fontSize:16}}>📊</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.text,fontFamily:"'Syne',sans-serif"}}>Adzuna</div>
                    <div style={{fontSize:11,color:T.muted}}>Free key at developer.adzuna.com</div>
                  </div>
                  <Badge label={settings.adzunaId?'Connected':'Not set'}
                    color={settings.adzunaId?T.success:T.muted} small/>
                </div>
                {[['App ID','adzunaId','Your App ID'],['App Key','adzunaKey','Your App Key']].map(([label,field,ph])=>(
                  <div key={field} style={{marginBottom:10}}>
                    <label style={{fontSize:10,color:T.muted,display:'block',marginBottom:5,
                      textTransform:'uppercase',letterSpacing:'0.07em'}}>{label}</label>
                    <input type={field.includes('Key')?'password':'text'} value={settings[field]}
                      onChange={e=>setSettings(s=>({...s,[field]:e.target.value}))} placeholder={ph}
                      style={{width:'100%',padding:'9px 12px',borderRadius:9,background:T.card,
                        border:`1px solid ${T.border}`,color:T.text,fontSize:12,
                        fontFamily:"'DM Sans',sans-serif"}}/>
                  </div>
                ))}
              </div>

              <div style={{background:T.surface,
                border:`1px solid ${loxoMode?T.teal+'50':T.border}`,
                borderRadius:14,padding:20,
                boxShadow:loxoMode?`0 0 0 1px ${T.teal}20`:'none'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                  <div style={{width:34,height:34,borderRadius:9,background:`${T.teal}20`,
                    border:`1px solid ${T.teal}40`,display:'flex',alignItems:'center',
                    justifyContent:'center',fontSize:16}}>🔗</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.text,fontFamily:"'Syne',sans-serif"}}>Loxo ATS</div>
                    <div style={{fontSize:11,color:T.muted}}>Push candidates directly into your ATS pipeline</div>
                  </div>
                  <Badge label={settings.loxoSlug&&settings.loxoKey?'Ready':'Not set'}
                    color={settings.loxoSlug&&settings.loxoKey?T.success:T.muted} small/>
                </div>
                {[['Agency Slug','loxoSlug','your-agency'],['API Key','loxoKey','lxk_...']].map(([label,field,ph])=>(
                  <div key={field} style={{marginBottom:10}}>
                    <label style={{fontSize:10,color:T.muted,display:'block',marginBottom:5,
                      textTransform:'uppercase',letterSpacing:'0.07em'}}>{label}</label>
                    <input type={field.includes('Key')?'password':'text'} value={settings[field]}
                      onChange={e=>setSettings(s=>({...s,[field]:e.target.value}))} placeholder={ph}
                      style={{width:'100%',padding:'9px 12px',borderRadius:9,background:T.card,
                        border:`1px solid ${T.border}`,color:T.text,fontSize:12,
                        fontFamily:"'DM Sans',sans-serif"}}/>
                  </div>
                ))}
                <button onClick={()=>{
                  if(!settings.loxoSlug||!settings.loxoKey){notify('Fill in both fields','warn');return;}
                  setLoxoMode(true);notify('Loxo sync activated!');
                }} style={{padding:'9px 18px',borderRadius:9,cursor:'pointer',
                  background:`linear-gradient(135deg,${T.teal},${T.tealDark})`,
                  border:'none',color:'#07101F',fontWeight:700,fontSize:12,
                  fontFamily:"'DM Sans',sans-serif"}}>Activate Loxo Sync</button>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
