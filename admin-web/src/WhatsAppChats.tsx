import React, { useCallback, useEffect, useState } from 'react';
import apiClient from './api';

type Chat = {phone:string;latest_body:string;latest_at:string;latest_direction:'IN'|'OUT';unread:number;last_inbound?:string};
type ChatMessage = {id:string;direction:'IN'|'OUT';kind:string;body:string;status:string;at:string};
const panel:React.CSSProperties={background:'rgba(15,23,42,.94)',border:'1px solid #475569',borderRadius:14,padding:12};
const field:React.CSSProperties={background:'#020617',color:'#f8fafc',border:'1px solid #64748b',borderRadius:8,padding:10,width:'100%',boxSizing:'border-box'};
const button:React.CSSProperties={background:'#7c3aed',color:'#fff',border:0,borderRadius:8,padding:'10px 14px',fontWeight:700,cursor:'pointer'};
function err(value:unknown):string {
  return value && typeof value==='object' && 'message' in value && typeof value.message==='string'
    ? value.message : 'Unable to load WhatsApp inbox.';
}
function time(value:string) {
  const d=new Date(value);
  return Number.isFinite(d.getTime())?d.toLocaleString():'Timestamp unavailable';
}
export function WhatsAppChats({onUnreadChange}:{onUnreadChange?:(value:number)=>void}) {
  const [threads,setThreads]=useState<Chat[]>([]);
  const [selected,setSelected]=useState('');
  const [messages,setMessages]=useState<ChatMessage[]>([]);
  const [windowOpen,setWindowOpen]=useState(false);
  const [repliesEnabled,setRepliesEnabled]=useState(false);
  const [draft,setDraft]=useState('');
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const refresh=useCallback(async()=>{
    try{
      const [list,stats]=await Promise.all([
        apiClient.get('/api/control-center/whatsapp/chats'),
        apiClient.get('/api/control-center/whatsapp/stats')
      ]);
      setThreads(Array.isArray(list.data?.threads)?list.data.threads:[]);
      onUnreadChange?.(Number(stats.data?.counts?.unread||0));
      setRepliesEnabled(stats.data?.replies_enabled===true);
      setError('');
    }catch(e){setError(err(e));}
  },[onUnreadChange]);

  const openChat=useCallback(async(phone:string)=>{
    setBusy(true);setError('');setSelected(phone);setDraft('');setCode('');
    try{
      const response=await apiClient.get('/api/control-center/whatsapp/chats/'+encodeURIComponent(phone));
      setMessages(Array.isArray(response.data?.messages)?response.data.messages:[]);
      setWindowOpen(response.data?.within_customer_service_window===true);
      await apiClient.post('/api/control-center/whatsapp/chats/'+encodeURIComponent(phone)+'/read');
      await refresh();
    }catch(e){setError(err(e));setMessages([]);}
    finally{setBusy(false);}
  },[refresh]);
  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>{void refresh();},20000);
    return()=>window.clearInterval(timer);
  },[refresh]);
  async function sendReply(e:React.FormEvent){
    e.preventDefault();
    if(!selected||!windowOpen||!repliesEnabled||draft.trim().length<1||draft.trim().length>1000
      || !/^[0-9]{6}$/.test(code.trim()))return;
    if(!window.confirm('Send this one-to-one support reply from the approved TrackMyRMC WhatsApp number?'))return;
    setBusy(true);setError('');setNotice('');
    const requestId=crypto.randomUUID();
    try{
      await apiClient.post('/api/control-center/step-up',{code:code.trim()});
      setCode('');
      const result=await apiClient.post('/api/control-center/whatsapp/chats/'+encodeURIComponent(selected)+'/reply',
        {message:draft.trim(),request_id:requestId});
      // Meta acceptance is not customer delivery.
      if(result.data?.status==='accepted'){
        setNotice('Reply accepted by Meta; delivery confirmation pending.');
      }else{
        setNotice('Provider outcome: '+String(result.data?.status||'unknown')+'. Do not retry without checking status.');
      }
      setDraft('');
      await openChat(selected);
    }catch(e){setError(err(e));setCode('');}
    finally{setBusy(false);}
  }
  return <section aria-label="WhatsApp Chats" style={{...panel,marginTop:16}} id="whatsapp-chats">
    <h2 style={{fontSize:19,margin:'0 0 6px'}}>WhatsApp Chats — Customer Inbox</h2>
    <p style={{fontSize:12,color:'#cbd5e1'}}>Verified inbound Meta messages only. No bulk messaging, media downloads or automated replies. Message content remains private to approved Central Admin operators.</p>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
      <strong style={{fontSize:13}}>{threads.length} recent conversations</strong>
      <button type="button" onClick={()=>void refresh()} style={{...button,background:'#334155'}}>Refresh chats</button>
    </div>
    {error&&<p role="alert" style={{color:'#fecaca'}}>{error}</p>}
    {notice&&<p role="status" style={{color:'#86efac'}}>{notice}</p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:12,marginTop:12}}>
      <div aria-label="WhatsApp conversations" style={{...panel,maxHeight:550,overflowY:'auto',background:'#111827'}}>
        {threads.map(chat=><button type="button" key={chat.phone} onClick={()=>void openChat(chat.phone)}
          aria-label={'Open WhatsApp chat '+chat.phone}
          style={{display:'block',width:'100%',marginBottom:8,padding:12,textAlign:'left',cursor:'pointer',
            color:'#f8fafc',background:chat.phone===selected?'#31265d':'#1e293b',
            border:'1px solid #475569',borderRadius:10}}>
          <strong>+{chat.phone}</strong>{Number(chat.unread)>0&&<span style={{float:'right',color:'#86efac'}}>● {chat.unread} new</span>}
          <div style={{fontSize:12,marginTop:5,overflowWrap:'anywhere',color:'#cbd5e1'}}>{chat.latest_body}</div>
          <small style={{color:'#94a3b8'}}>{time(chat.latest_at)}</small>
        </button>)}
        {!threads.length&&<p style={{color:'#cbd5e1'}}>No incoming WhatsApp conversations recorded.</p>}
      </div>
      <div style={{...panel,minHeight:330,background:'#111827'}} aria-label="WhatsApp conversation detail">
        {!selected?<p>Select a conversation to view customer messages.</p>:<>
          <h3 style={{fontSize:16,marginTop:0}}>Conversation with +{selected}</h3>
          <div role="log" aria-label="WhatsApp messages" style={{maxHeight:380,overflowY:'auto',display:'grid',gap:9,padding:9}}>
            {messages.map(m=><div key={m.id} style={{justifySelf:m.direction==='OUT'?'end':'start',maxWidth:'87%',
              padding:'9px 12px',borderRadius:12,color:'#f8fafc',
              background:m.direction==='OUT'?'#3c3266':'#334155',overflowWrap:'anywhere'}}>
              <div style={{whiteSpace:'pre-wrap',fontSize:13}}>{m.body}</div>
              <small style={{fontSize:10,color:'#cbd5e1'}}>{time(m.at)} · {m.direction==='OUT'?m.status:'Received'}</small>
            </div>)}
            {!messages.length&&<p>No messages loaded for this conversation.</p>}
          </div>
          {repliesEnabled&&windowOpen?<form onSubmit={e=>void sendReply(e)} style={{marginTop:16,display:'grid',gap:8}}>
            <label htmlFor="whatsapp-reply">Manual support reply (maximum 1,000 characters)</label>
            <textarea id="whatsapp-reply" style={field} value={draft} onChange={e=>setDraft(e.target.value)}
              maxLength={1000} rows={3} disabled={busy} autoComplete="off"/>
            <label htmlFor="whatsapp-reply-mfa">Fresh authenticator code</label>
            <input id="whatsapp-reply-mfa" style={field} value={code} onChange={e=>setCode(e.target.value)}
              maxLength={6} pattern="[0-9]{6}" type="password" inputMode="numeric" disabled={busy}/>
            <button type="submit" style={button} disabled={busy||!draft.trim()||code.length!==6}>Send WhatsApp reply</button>
          </form>:<p style={{fontSize:12,color:'#fbbf24',marginTop:14}}>
            {!repliesEnabled?'Live operator replies are disabled until provider acceptance.':
              'The 24-hour customer service window has expired. Wait for a customer message.'}
          </p>}
        </>}
      </div>
    </div>
  </section>;
}