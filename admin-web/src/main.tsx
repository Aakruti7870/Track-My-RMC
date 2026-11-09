import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import apiClient, { getAccessToken, setAccessToken } from './api';

type Stage = 'central-login' | 'central-otp' | 'central-mfa' | 'central-recover' | 'central-recovery-codes' | 'authority-login' | 'authority-password' | 'email' | 'otp' | 'mfa-enroll' | 'mfa-login' | 'authenticated';

type StaffUser = {
  id?: string;
  email?: string | null;
  phone?: string;
  full_name?: string;
  role: string;
};

type Health = {
  status?: string;
  database?: string;
  environment?: string;
  timestamp?: string;
};

type PortalKpi = { label: string; value: string | number };
type AuthorityAccount = {
  id: string; email: string; full_name: string; enabled: boolean;
  mfa_enrolled: boolean; permissions: string[];
};
const AUTHORITY_GRANTS = [
  { key:'user.view', label:'Customer and role directory' },
  { key:'plant.view', label:'Plant directory' },
  { key:'order.view', label:'Order status' },
  { key:'support.view', label:'Service, RFQ and marketing lead monitoring' },
  { key:'support.reply', label:'Support replies and internal follow-up alerts (requires support.view)' },
  { key:'kyc.view', label:'Customer KYC review queue' },
  { key:'kyc.review', label:'Approve/reject customer KYC with recent MFA' },
];

type NativeAutomationTemplate = {
  key: string;
  label: string;
  event_type: string;
  action_type: string;
  version: number;
  published: boolean;
  globally_paused: boolean;
  enabled_plants: number;
  conditions: {
    min_quantity_m3?: number | null;
    max_quantity_m3?: number | null;
    grade_in?: string[];
  };
};
type NativeAutomationHealth = {
  worker_enabled: boolean;
  heartbeat: { recent: boolean; last_seen_at: string } | null;
  job_counts: { status: string; count: number }[];
};
type NativeAutomationJob = {
  id: string; template_key: string; status: string; attempts: number;
  updated_at: string;
};

type Enrollment = {
  account: string;
  manual_key: string;
  otpauth_uri: string;
  recovery_codes: string[];
};

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; error?: unknown; detail?: unknown };
    for (const candidate of [value.message, value.error, value.detail]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
    }
  }
  return 'The request could not be completed. Please try again.';
}

function CommandCenter({ initialNotice, onSignedOut }: { initialNotice: string; onSignedOut: (message: string) => void }) {
  const [stage, setStage] = useState<Stage>('central-login');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [privilegedPassword, setPrivilegedPassword] = useState('');
  const [newAuthorityPassword, setNewAuthorityPassword] = useState('');
  const [confirmAuthorityPassword, setConfirmAuthorityPassword] = useState('');
  const [authorityEnrollment, setAuthorityEnrollment] = useState(false);
  const [oldWebPassword, setOldWebPassword] = useState('');
  const [newWebPassword, setNewWebPassword] = useState('');
  const [newWebPasswordConfirm, setNewWebPasswordConfirm] = useState('');
  const [rotationCode, setRotationCode] = useState('');
  const [rotationReason, setRotationReason] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false);
  const [centralRecoveryCodes, setCentralRecoveryCodes] = useState<string[]>([]);
  const [user, setUser] = useState<StaffUser | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [adminKpis, setAdminKpis] = useState<PortalKpi[]>([]);
  const [adminOverviewError, setAdminOverviewError] = useState('');
  const [permissions,setPermissions]=useState<string[]>([]);
  const [workspace,setWorkspace]=useState('');
  const [records,setRecords]=useState<Array<Record<string,unknown>>>([]);
  const [workspaceOffset,setWorkspaceOffset]=useState(0);
  const [workspaceLoading,setWorkspaceLoading]=useState(false);
  const [workspaceError,setWorkspaceError]=useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(initialNotice);
  const [rfqOutreachCode, setRfqOutreachCode] = useState('');
  const [rfqOutreachNotes, setRfqOutreachNotes] = useState<Record<string,string>>({});
  const [ownerRequests,setOwnerRequests]=useState<Array<Record<string,any>>>([]);
  const [ownerCode,setOwnerCode]=useState('');
  const [ownerReason,setOwnerReason]=useState('');
  const [ownerId,setOwnerId]=useState('');
  const [ownerFields,setOwnerFields]=useState<Record<string,{city:string;state:string;pincode:string}>>({});
  const [showOwners,setShowOwners]=useState(false);
  const [showPlantProfiles,setShowPlantProfiles]=useState(false);
  const [showNativeAutomation,setShowNativeAutomation]=useState(false);
  const [automationTemplates,setAutomationTemplates]=useState<NativeAutomationTemplate[]>([]);
  const [automationHealth,setAutomationHealth]=useState<NativeAutomationHealth | null>(null);
  const [automationJobs,setAutomationJobs]=useState<NativeAutomationJob[]>([]);
  const [automationCode,setAutomationCode]=useState('');
  const [automationMin,setAutomationMin]=useState('');
  const [automationMax,setAutomationMax]=useState('');
  const [automationGrades,setAutomationGrades]=useState('');
  const [automationKey,setAutomationKey]=useState('');
  const [plantProfileQueue,setPlantProfileQueue]=useState<Array<Record<string,any>>>([]);
  const [plantProfileCode,setPlantProfileCode]=useState('');
  const [plantProfileReason,setPlantProfileReason]=useState('');
  const [authorityAccounts,setAuthorityAccounts]=useState<AuthorityAccount[]>([]);
  const [showAuthorityAccounts,setShowAuthorityAccounts]=useState(false);
  const [authorityEmail,setAuthorityEmail]=useState('');
  const [authorityName,setAuthorityName]=useState('');
  const [authorityEnabled,setAuthorityEnabled]=useState(true);
  const [authorityGrants,setAuthorityGrants]=useState<string[]>(['support.view','kyc.view']);
  const [authorityReason,setAuthorityReason]=useState('');
  const [authorityAdminCode,setAuthorityAdminCode]=useState('');
  const [authorityReviewCode,setAuthorityReviewCode]=useState('');
  const [authorityReviewReason,setAuthorityReviewReason]=useState('');
  const [centralKycReason,setCentralKycReason]=useState('');
  const [centralKycCode,setCentralKycCode]=useState('');
  const [supportCase,setSupportCase]=useState<Record<string,any>|null>(null);
  const [supportAlerts,setSupportAlerts]=useState<Array<Record<string,any>>>([]);
  const [supportAlertsLoaded,setSupportAlertsLoaded]=useState(false);
  const [supportReply,setSupportReply]=useState('');
  const [supportInternal,setSupportInternal]=useState(false);
  const [supportStepUp,setSupportStepUp]=useState('');
  const [serviceReason,setServiceReason]=useState('');
  const [serviceStepUp,setServiceStepUp]=useState('');


  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;

    let active = true;
    apiClient.get('/api/me')
      .then(async (response) => {
        const currentUser = response.data?.user as StaffUser | undefined;
        if (!active || !currentUser?.role) return;
        if (currentUser.role === 'central_admin' || currentUser.role === 'authority') {
          const endpoint = currentUser.role === 'authority' ? '/api/authority/auth/me' : '/api/admin/auth/me';
          const session = await apiClient.get(endpoint);
          setPermissions(session.data?.permissions || []);
        } else if (!['plant_owner','owner','dispatcher','operator','supervisor',
          'quality_engineer','store_manager','accountant','fleet_manager','admin'].includes(currentUser.role)) {
          throw new Error('Not a supported web account');
        }
        setUser(currentUser);
        setStage('authenticated');
      })
      .catch(() => {
        setAccessToken(null);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (stage !== 'authenticated') return;
    let active = true;
    apiClient.get('/health')
      .then((response) => { if (active) setHealth(response.data as Health); })
      .catch(() => { if (active) setHealth(null); });
    return () => { active = false; };
  }, [stage]);

  useEffect(() => {
    if (stage !== 'authenticated' || user?.role !== 'central_admin') {
      setAdminKpis([]);
      setAdminOverviewError('');
      return;
    }
    let active = true;
    apiClient.get('/api/control-center/summary')
      .then((response) => {
        if (!active) return;
        const kpis: unknown = response.data?.kpis;
        setAdminKpis(Array.isArray(kpis) ? kpis.filter((item): item is PortalKpi =>
          typeof item?.label === 'string' &&
          (typeof item?.value === 'number' || typeof item?.value === 'string')
        ) : []);
        setAdminOverviewError('');
      })
      .catch((requestError) => {
        if (!active) return;
        setAdminKpis([]);
        setAdminOverviewError(errorMessage(requestError));
      });
    return () => { active = false; };
  }, [stage, user?.role]);

  async function loadNativeAutomation() {
    setShowNativeAutomation(true);setBusy(true);setError('');
    try {
      // List/health use system.view. Cross-plant private records are intentionally
      // absent from the global monitoring response.
      const [catalog,health,history] = await Promise.all([
        apiClient.get('/api/control-center/automation/templates'),
        apiClient.get('/api/control-center/automation/health'),
        permissions.includes('audit.view')
          ? apiClient.get('/api/control-center/automation/jobs') : Promise.resolve(null),
      ]);
      const items:NativeAutomationTemplate[]=catalog.data?.templates||[];
      setAutomationTemplates(items);
      setAutomationHealth(health.data as NativeAutomationHealth);
      setAutomationJobs(history?.data?.jobs||[]);
      setAutomationKey(current => items.some(item => item.key === current) ? current : items[0]?.key||'');
    } catch(err) {setError(errorMessage(err));}
    finally {setBusy(false);}
  }

  async function updateAutomationPolicy(template:NativeAutomationTemplate,published:boolean,paused:boolean) {
    if (!permissions.includes('automation.manage') || !automationCode.trim()) {
      setError('Automation management permission and a fresh authenticator code are required.');
      return;
    }
    if (!paused && !window.confirm('Resume this workflow for all opted-in plants?')) return;
    setBusy(true);setError('');setNotice('');
    try {
      await apiClient.post('/api/control-center/step-up',{code:automationCode.trim()});
      setAutomationCode('');
      await apiClient.post('/api/control-center/automation/templates/'+encodeURIComponent(template.key)+'/policy',
        {published,globally_paused:paused});
      setNotice('Automation policy updated and audited.');
      await loadNativeAutomation();
    } catch(err) {setError(errorMessage(err));}
    finally {setBusy(false);}
  }

  async function updateAutomationConditions() {
    if (!permissions.includes('automation.manage') || !automationCode.trim()) {
      setError('Automation management permission and a fresh authenticator code are required.');
      return;
    }
    const selected=automationTemplates.find(item=>item.key===automationKey);
    if (!selected?.globally_paused) {
      setError('Pause the selected workflow before changing its conditions.');
      return;
    }
    const min=automationMin.trim() === '' ? null : Number(automationMin);
    const max=automationMax.trim() === '' ? null : Number(automationMax);
    if ([min,max].some(value=>value!==null && (!Number.isFinite(value) || value<0 || value>100000))
      || (min!==null && max!==null && min>max)) {
      setError('Quantity limits must be between 0 and 100000 m³, minimum no greater than maximum.');
      return;
    }
    const grades=automationGrades.split(',').map(value=>value.trim()).filter(Boolean);
    if (grades.length>16 || grades.some(value=>!/^[A-Za-z0-9-]{1,24}$/.test(value))) {
      setError('Use at most 16 valid concrete grades, separated by commas.');
      return;
    }
    setBusy(true);setError('');setNotice('');
    try {
      await apiClient.post('/api/control-center/step-up',{code:automationCode.trim()});
      setAutomationCode('');
      await apiClient.put('/api/control-center/automation/templates/'+encodeURIComponent(automationKey)+'/conditions',{
        conditions:{min_quantity_m3:min,max_quantity_m3:max,grade_in:grades}
      });
      setNotice('Versioned rule conditions saved; workflow remains paused.');
      await loadNativeAutomation();
    } catch(err) {setError(errorMessage(err));}
    finally {setBusy(false);}
  }

  async function retryNativeAutomationJob(job:string) {
    if (!permissions.includes('automation.manage') || !automationCode.trim()) {
      setError('Automation management permission and a fresh authenticator code are required.');
      return;
    }
    if (!window.confirm('Requeue this dead-letter job under current live security rules?')) return;
    setBusy(true);setError('');setNotice('');
    try {
      await apiClient.post('/api/control-center/step-up',{code:automationCode.trim()});
      setAutomationCode('');
      await apiClient.post('/api/control-center/automation/jobs/'+encodeURIComponent(job)+'/requeue');
      setNotice('Dead-letter job requeued for authorization checks.');
      await loadNativeAutomation();
    } catch(err) {setError(errorMessage(err));}
    finally {setBusy(false);}
  }

  useEffect(()=>{
    const item=automationTemplates.find(template=>template.key===automationKey);
    if (!item) {setAutomationMin('');setAutomationMax('');setAutomationGrades('');return;}
    setAutomationMin(item.conditions?.min_quantity_m3?.toString()??'');
    setAutomationMax(item.conditions?.max_quantity_m3?.toString()??'');
    setAutomationGrades((item.conditions?.grade_in||[]).join(', '));
  },[automationKey,automationTemplates]);

  async function loadWorkspace(kind:string,offset=0) {
    setBusy(true);setError('');setWorkspace(kind);setRecords([]);setWorkspaceOffset(offset);
    setWorkspaceLoading(true);setWorkspaceError('');
    setSupportCase(null);setSupportAlerts([]);setSupportAlertsLoaded(false);
    setSupportReply('');setSupportInternal(false);setSupportStepUp('');
    try {
      const prefix=user?.role==='authority'?'/api/authority/collections/':'/api/control-center/collections/';
      const response=await apiClient.get(prefix+encodeURIComponent(kind),{params:{limit:25,offset}});
      setRecords(response.data.items || []);setWorkspaceOffset(offset);
      if(kind==='support' && permissions.includes('support.reply')) {
        try {
          const alerts=await apiClient.get('/api/assistant/support/staff/alerts');
          setSupportAlerts(alerts.data?.alerts||[]);setSupportAlertsLoaded(true);
        } catch (alertError) {
          setError('Support alerts unavailable: '+errorMessage(alertError));
        }
      }
    } catch(error) {setRecords([]);setWorkspaceError(errorMessage(error));}
    finally {setBusy(false);setWorkspaceLoading(false);}
  }


  async function loadPlantProfileQueue(){
    setBusy(true);setError('');setShowPlantProfiles(true);
    try{
      const result=await apiClient.get('/api/control-center/plant-profile/pending');
      setPlantProfileQueue(result.data.items||[]);
    }catch(e){setError(errorMessage(e));}
    finally{setBusy(false);}
  }
  async function decidePlantProfile(plant:string,section:string,approve:boolean){
    if(!plantProfileCode.trim()||(!approve && plantProfileReason.trim().length<10)){
      setError('Enter a current authenticator code and a reason of at least 10 characters for rejection.');
      return;
    }
    setBusy(true);setError('');
    try{
      await apiClient.post('/api/control-center/step-up',{code:plantProfileCode.trim()});
      setPlantProfileCode('');
      await apiClient.post('/api/control-center/plants/'+encodeURIComponent(plant)+'/profile/'+encodeURIComponent(section)+'/decision',
        {approve,reason:plantProfileReason.trim()||'Certificate and plant details checked by administrator.'});
      setNotice(approve?'Published after admin review.':'Revision rejected with feedback.');
      setPlantProfileReason('');
      await loadPlantProfileQueue();
    }catch(e){setError(errorMessage(e));}
    finally{setBusy(false);}
  }
  async function reviewPlantCertificate(plant:string,cert:string){
    setError('');
    try{
      const result=await apiClient.get('/api/control-center/plants/'+encodeURIComponent(plant)+'/profile/document/'+encodeURIComponent(cert),
        {responseType:'blob'});
      const url=URL.createObjectURL(result.data);
      window.open(url,'_blank','noopener,noreferrer');
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(e){setError(errorMessage(e));}
  }
  async function loadOwnerRequests(){
    setBusy(true);setError('');setShowOwners(true);
    try{const response=await apiClient.get('/api/plant-discovery/requests');setOwnerRequests(response.data.requests||[]);}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  async function ownerAction(path:string,body:Record<string,unknown>){
    if(ownerReason.trim().length<10 || !ownerCode.trim()){setError('Enter a reason and a fresh authenticator code.');return;}
    setBusy(true);setError('');
    try{
      await apiClient.post('/api/control-center/step-up',{code:ownerCode.trim()});setOwnerCode('');
      await apiClient.post(path,{...body,reason:ownerReason.trim()});
      setNotice('Plant Owner action recorded and audited.');setOwnerReason('');await loadOwnerRequests();
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }

  async function recordRfqOutreach(id:string, status:'INVITATION_SHARED'|'CONTACTED'|'DECLINED') {
    if (!rfqOutreachCode.trim()) {
      setError('Enter a fresh authenticator code before recording supplier outreach.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      await apiClient.post('/api/control-center/step-up', { code:rfqOutreachCode.trim() });
      setRfqOutreachCode('');
      await apiClient.patch('/api/control-center/rmc-rfq-leads/'+encodeURIComponent(id)+'/outreach',{
        outreach_status:status, notes:rfqOutreachNotes[id]||null
      });
      setNotice('Supplier outreach activity recorded and audited.');
      await loadWorkspace('rmc_rfq_leads', workspaceOffset);
    } catch(err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  async function shareRmcOnboardingLink() {
    const url='https://trackmyrmc.com/plant-onboarding';
    const message='Join TrackMyRMC to receive and manage RMC quotation requests. Register your plant: '+url;
    try {
      if (navigator.share) {
        await navigator.share({title:'TrackMyRMC Plant Onboarding',text:message,url});
      } else {
        await navigator.clipboard.writeText(message);
        setNotice('Onboarding message copied. Share only with consented supplier contacts.');
      }
    } catch(err) { setError(errorMessage(err)); }
  }

  async function openSupportCase(caseId:string,alertId?:string) {
    setBusy(true);setError('');setSupportReply('');setSupportInternal(false);setSupportStepUp('');
    try {
      const response=await apiClient.get('/api/assistant/support/staff/cases/'+encodeURIComponent(caseId));
      setSupportCase(response.data?.case||null);
      if(alertId) {
        await apiClient.post('/api/assistant/support/staff/alerts/'+encodeURIComponent(alertId)+'/read');
        const remaining=await apiClient.get('/api/assistant/support/staff/alerts');
        setSupportAlerts(remaining.data?.alerts||[]);setSupportAlertsLoaded(true);
      }
    } catch(err) {setError(errorMessage(err));setSupportCase(null);}
    finally {setBusy(false);}
  }

  async function sendSupportReply() {
    if(!supportCase?.id||!supportReply.trim()||!permissions.includes('support.reply'))return;
    setBusy(true);setError('');
    try {
      await apiClient.post('/api/assistant/support/staff/cases/'+encodeURIComponent(String(supportCase.id))+'/replies',{
        message:supportReply.trim(),internal:supportInternal,
      });
      setSupportReply('');setNotice('Support response recorded.');
      const response=await apiClient.get('/api/assistant/support/staff/cases/'+encodeURIComponent(String(supportCase.id)));
      setSupportCase(response.data?.case||null);
    } catch(err){setError(errorMessage(err));}
    finally {setBusy(false);}
  }

  async function updateSupportStatus(status:string) {
    if(!supportCase?.id||!permissions.includes('support.manage'))return;
    setBusy(true);setError('');
    try {
      if(!/^[0-9]{6}$/.test(supportStepUp.trim()))throw new Error('Enter a current authenticator code.');
      await apiClient.post('/api/control-center/step-up',{code:supportStepUp.trim()});
      await apiClient.post('/api/assistant/support/staff/cases/'+encodeURIComponent(String(supportCase.id))+'/status',{status});
      setSupportStepUp('');setNotice('Support case status updated and audited.');
      const response=await apiClient.get('/api/assistant/support/staff/cases/'+encodeURIComponent(String(supportCase.id)));
      setSupportCase(response.data?.case||null);
    } catch(err){setError(errorMessage(err));setSupportStepUp('');}
    finally {setBusy(false);}
  }

  async function updateServiceEnquiry(id:string,status:string) {
    if(!permissions.includes('support.manage'))return;
    setBusy(true);setError('');
    try {
      if(serviceReason.trim().length<10||!/^[0-9]{6}$/.test(serviceStepUp.trim()))
        throw new Error('Enter an audit reason (10+ characters) and a fresh authenticator code.');
      await apiClient.post('/api/control-center/step-up',{code:serviceStepUp.trim()});
      await apiClient.patch('/api/admin/service-enquiries/'+encodeURIComponent(id)+'/status',{
        status,reason:serviceReason.trim(),
      });
      setServiceStepUp('');setServiceReason('');setNotice('Service enquiry status updated.');
      const response=await apiClient.get('/api/control-center/collections/service_enquiries',{params:{limit:25,offset:workspaceOffset}});
      setRecords(response.data?.items||[]);
    }catch(err){setError(errorMessage(err));setServiceStepUp('');}
    finally{setBusy(false);}
  }

  async function loadAuthorityAccounts() {
    setBusy(true); setError(''); setShowAuthorityAccounts(true);
    try {
      const response=await apiClient.get('/api/control-center/authority-access');
      setAuthorityAccounts(response.data?.accounts||[]);
    } catch(err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  async function saveAuthorityAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');
    try {
      if (!authorityEmail.trim() || !authorityName.trim() || authorityReason.trim().length<10
        || !/^[0-9]{6}$/.test(authorityAdminCode.trim())) {
        throw new Error('Provide approved email, full name, an audit reason (10+ characters), and a current six-digit authenticator code.');
      }
      await apiClient.post('/api/control-center/step-up',{code:authorityAdminCode.trim()});
      await apiClient.post('/api/control-center/authority-access',{
        email:authorityEmail.trim().toLowerCase(), full_name:authorityName.trim(),
        enabled:authorityEnabled,permissions:authorityGrants,reason:authorityReason.trim(),
      });
      setAuthorityAdminCode('');setAuthorityReason('');
      setNotice('Authority access saved. Previous sessions were revoked.');
      const response=await apiClient.get('/api/control-center/authority-access');
      setAuthorityAccounts(response.data?.accounts||[]);
    } catch(err) {setError(errorMessage(err));setAuthorityAdminCode('');}
    finally {setBusy(false);}
  }

  async function reviewCentralKyc(customerId:string, decision:'approve'|'reject'|'reset') {
    setBusy(true);setError('');
    try {
      if (!/^[0-9]{6}$/.test(centralKycCode.trim()) || centralKycReason.trim().length<10) {
        throw new Error('A current six-digit authenticator code and specific reason (10+ characters) are required.');
      }
      await apiClient.post('/api/control-center/step-up',{code:centralKycCode.trim()});
      await apiClient.post('/api/control-center/customers/'+encodeURIComponent(customerId)+'/kyc/'+decision,
        {reason:centralKycReason.trim()});
      setCentralKycCode('');setCentralKycReason('');
      setNotice('Central Admin KYC decision recorded in the audit log.');
      const response=await apiClient.get('/api/control-center/collections/kyc',{params:{limit:25,offset:0}});
      setRecords(response.data?.items||[]);setWorkspaceOffset(0);
    } catch(err) {setError(errorMessage(err));setCentralKycCode('');}
    finally {setBusy(false);}
  }

  async function reviewAuthorityKyc(customerId:string, approve:boolean) {
    setBusy(true);setError('');
    try {
      if (!/^[0-9]{6}$/.test(authorityReviewCode.trim()) || authorityReviewReason.trim().length<10 || authorityReviewReason.trim().length>500)
        throw new Error('Enter a fresh six-digit authenticator code and a specific reason (10-500 characters).');
      await apiClient.post('/api/authority/auth/step-up',{code:authorityReviewCode.trim()});
      await apiClient.post('/api/staff/customers/'+encodeURIComponent(customerId)+'/kyc/'+(approve?'approve':'reject'),
        {reason:authorityReviewReason.trim()});
      setAuthorityReviewCode('');setAuthorityReviewReason('');
      setNotice('KYC decision recorded in the audit log.');
      const response=await apiClient.get('/api/authority/collections/kyc',{params:{limit:25,offset:0}});
      setRecords(response.data?.items||[]);setWorkspaceOffset(0);
    } catch(err) {setError(errorMessage(err));setAuthorityReviewCode('');}
    finally {setBusy(false);}
  }

  function restartCentralLogin() {
    setOtp(''); setMfaCode(''); setChallengeToken(''); setEnrollment(null);
    setError(''); setNotice(''); setStage('central-login');
  }

  async function sendCentralOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await apiClient.post('/api/admin/auth/otp/send', { email: email.trim() });
      setStage('central-otp');
      setNotice('Enter the verification code sent to your registered email.');
    } catch (error) {
      setError(errorMessage(error));
    } finally { setBusy(false); }
  }

  async function verifyCentralOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const {data} = await apiClient.post('/api/admin/auth/login', {
        email: email.trim(), otp: otp.trim(),
      });
      if (!data?.challenge_token) throw new Error('The server did not return a valid MFA challenge.');
      setChallengeToken(data.challenge_token);
      setEnrollment(data.enrollment || null);
      setOtp(''); setStage('central-mfa');
    } catch (error) {
      setError(errorMessage(error));
    } finally { setBusy(false); }
  }

  async function verifyCentralMfa(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (stage === 'central-recover') {
        const {data} = await apiClient.post('/api/admin/auth/recover', {
          challenge_token: challengeToken, code: mfaCode.trim(),
        });
        if (!data?.challenge_token || !data.enrollment) throw new Error('The server did not return authenticator setup.');
        setChallengeToken(data.challenge_token); setEnrollment(data.enrollment);
        setMfaCode(''); setStage('central-mfa');
        return;
      }

      const {data} = await apiClient.post('/api/admin/auth/verify-totp', {
        challenge_token: challengeToken, code: mfaCode.trim(),
      });
      if (!data?.token || data?.user?.role !== 'central_admin') throw new Error('Central Admin session was not established.');
      setAccessToken(data.token);
      setChallengeToken(''); setMfaCode(''); setEnrollment(null);
      if (data.recovery_codes?.length) {
        setUser(data.user); setCentralRecoveryCodes(data.recovery_codes);
        setRecoveryCodesSaved(false); setStage('central-recovery-codes');
      } else {
        const session = await apiClient.get('/api/admin/auth/me');
        setPermissions(session.data?.permissions || []);
        setUser(data.user); setStage('authenticated');
      }
    } catch (error) {
      setAccessToken(null);
      setError(errorMessage(error));
    } finally { setBusy(false); }
  }

  async function finishCentralEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const session = await apiClient.get('/api/admin/auth/me');
      setPermissions(session.data?.permissions || []);
      setCentralRecoveryCodes([]); setRecoveryCodesSaved(false); setStage('authenticated');
    } catch (error) {
      setError(errorMessage(error));
    } finally { setBusy(false); }
  }

  async function authorityLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const prefix = '/api/authority/auth';
      const response = await apiClient.post(prefix+'/verify-totp', {
        identifier: email.trim(), password: privilegedPassword, code: mfaCode.trim(),
      });
      if (!response.data?.token || response.data?.user?.role !== 'authority') throw new Error('Privileged web session was not established.');
      setAccessToken(response.data.token);
      const session=await apiClient.get(prefix+'/me');
      setPermissions(session.data?.permissions || []);
      setUser(response.data.user); setMfaCode(''); setPrivilegedPassword(''); setStage('authenticated');
    } catch (error) {
      setAccessToken(null);
      setPrivilegedPassword('');
      setError(errorMessage(error));
    } finally { setBusy(false); }
  }

  async function sendEmailOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The reserved Central Admin identity must never use Plant Staff OTP:
    // its initial inactive state is expected until email OTP + TOTP enrollment.
    // Reuse the existing dedicated web challenge instead of adding credentials.
    if (email.trim().toLowerCase() === 'support@trackmyrmc.com') {
      await sendCentralOtp(event);
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiClient.post('/api/auth/otp/email/send', { email: email.trim().toLowerCase() });
      setStage('otp');
      setNotice('If this address belongs to an active staff account, a verification code has been sent.');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.post('/api/auth/otp/email/verify', {
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
      });
      const result = response.data;
      if (!result?.challenge_token) throw new Error('The server did not return a valid MFA challenge.');
      setChallengeToken(result.challenge_token);

      if (result.mfa_setup_required || result.status === 'MFA_ENROLLMENT_REQUIRED') {
        const setupResponse = await apiClient.post('/api/auth/staff/mfa/enroll/start', {
          challenge_token: result.challenge_token,
        });
        setEnrollment(setupResponse.data as Enrollment);
        setRecoveryCodesSaved(false);
        setStage('mfa-enroll');
        setNotice('First-time setup required. Add this account to your authenticator and store the recovery codes before continuing.');
      } else {
        setStage(authorityEnrollment ? 'authority-password' : 'mfa-login');
        setNotice(authorityEnrollment
          ? 'Email verified. Set your Authority password using your authenticator code.'
          : 'Email verified. Enter the current authenticator code or an unused recovery code.');
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoveryCodesSaved) {
      setError('Confirm that you have saved the recovery codes before enabling the authenticator.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.post('/api/auth/staff/mfa/enroll/confirm', {
        challenge_token: challengeToken,
        code: mfaCode.trim(),
      });
      if (!response.data?.challenge_token) throw new Error('The server did not return the next MFA challenge.');
      setChallengeToken(response.data.challenge_token);
      setEnrollment(null);
      setMfaCode('');
      setStage(authorityEnrollment ? 'authority-password' : 'mfa-login');
      setNotice(authorityEnrollment
        ? 'Authenticator enabled. Set a distinct Authority password to finish enrollment.'
        : 'Authenticator enabled. Complete staff sign-in with MFA.');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function completeAuthorityEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try {
      if (newAuthorityPassword.length < 16 || newAuthorityPassword.length > 128 ||
        newAuthorityPassword !== confirmAuthorityPassword || !/^[0-9]{6}$/.test(mfaCode.trim()))
        throw new Error('Use a distinct 16-128 character password, matching confirmation, and a six-digit authenticator code.');
      await apiClient.post('/api/authority/auth/set-initial-password',{
        challenge_token:challengeToken,password:newAuthorityPassword,code:mfaCode.trim(),
      });
      setNewAuthorityPassword('');setConfirmAuthorityPassword('');
      setMfaCode('');setChallengeToken('');setAuthorityEnrollment(false);
      setStage('authority-login');
      setNotice('Authority credentials enrolled. Sign in with your password and authenticator.');
    } catch(requestError) {setError(errorMessage(requestError));}
    finally{setBusy(false);}
  }

  async function verifyMfa(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.post('/api/auth/staff/mfa/verify-totp', {
        challenge_token: challengeToken,
        code: mfaCode.trim(),
      });
      const auth = response.data;
      const signedInUser = auth?.user as StaffUser | undefined;
      if (!auth?.token || !signedInUser?.role) {
        throw new Error('The server response did not contain a valid authenticated session.');
      }
      const allowedRoles = ['plant_owner','dispatcher', 'operator', 'supervisor', 'quality_engineer', 'store_manager', 'accountant', 'fleet_manager', 'owner', 'admin'];
      if (!allowedRoles.includes(signedInUser.role)) {
        throw new Error('This account is not authorized for staff portal access.');
      }
      setAccessToken(auth.token);
      setUser(signedInUser);
      setMfaCode('');
      setChallengeToken('');
      setStage('authenticated');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function rotateWebPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try {
      if(user?.role !== 'authority'
        || newWebPassword.length<16 || newWebPassword.length>128
        || newWebPassword!==newWebPasswordConfirm || newWebPassword===oldWebPassword
        || !/^[0-9]{6}$/.test(rotationCode.trim()) || rotationReason.trim().length<10) {
        throw new Error('Current password, distinct 16-128 character new password, matching confirmation, current authenticator code and audit reason are required.');
      }
      await apiClient.post('/api/authority/auth/change-password',{
        current_password:oldWebPassword,new_password:newWebPassword,
        code:rotationCode.trim(),reason:rotationReason.trim(),
      });
      setOldWebPassword('');setNewWebPassword('');setNewWebPasswordConfirm('');
      setRotationCode('');setRotationReason('');
      await logout('Password rotated. All existing privileged sessions were revoked; sign in again.');
    }catch(err){setError(errorMessage(err));}
    finally{setBusy(false);}
  }

  async function logout(message?: string) {
    setBusy(true);
    let revokedOnServer = false;
    try {
      await apiClient.post(user?.role === 'central_admin' ? '/api/admin/auth/logout' : user?.role === 'authority' ? '/api/authority/auth/logout' : '/api/auth/logout');
      revokedOnServer = true;
    } catch {
      // Always clear this browser session, even if the server is temporarily unreachable.
    } finally {
      setAccessToken(null);
      // Remount the entire workspace: every record, password, MFA code and
      // unsent draft belongs to one authenticated account only.
      onSignedOut(message || (revokedOnServer
        ? 'Signed out and server session revoked.'
        : 'Signed out locally. Server revocation could not be confirmed; the session expires automatically.'));
    }
  }

  const pageStyle: React.CSSProperties = {
    minHeight: '100vh', padding: stage === 'authenticated' ? '20px clamp(10px, 3vw, 38px)' : '32px 18px',
    boxSizing: 'border-box',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    background: 'radial-gradient(ellipse at top, #1e3a5f 0%, #0f172a 52%, #020617 100%)',
    color: '#f8fafc', display: 'flex', justifyContent: 'center',
    alignItems: stage === 'authenticated' ? 'flex-start' : 'center',
  };
  const panelStyle: React.CSSProperties = {
    width: '100%', maxWidth: stage === 'authenticated' ? 1280 : 560,
    boxSizing: 'border-box', padding: stage === 'authenticated' ? 'clamp(14px, 3vw, 30px)' : 28,
    borderRadius: 18, border: '1px solid #334155', background: 'rgba(15, 23, 42, 0.94)',
    boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px', marginTop: 7,
    borderRadius: 9, border: '1px solid #475569', background: '#020617', color: '#f8fafc',
    fontSize: 16, outlineOffset: 2,
  };
  const buttonStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', border: 0, borderRadius: 9, marginTop: 16,
    background: busy ? '#475569' : '#7c3aed', color: '#fff', fontWeight: 700,
    fontSize: 15, cursor: busy ? 'wait' : 'pointer',
  };

  const workspaceFeedback = workspaceLoading
    ? <p role="status">Loading records…</p>
    : workspaceError
      ? <div role="alert"><p>{workspaceError}</p><button type="button" disabled={busy}
          onClick={()=>void loadWorkspace(workspace,workspaceOffset)}>Retry loading records</button></div>
      : records.length === 0 ? <p>No records on this page.</p> : null;

  const supportWorkspace = workspace === 'support' && permissions.includes('support.view') && (
                  <section aria-label="Support case management" style={{border:'1px solid #475569',borderRadius:12,padding:14,marginTop:14}}>
                    <h3 style={{fontSize:16}}>Customer Support Operations</h3>
                    <p style={{fontSize:12,color:'#cbd5e1'}}>Open a case to view its conversation. Replies and status changes use dedicated server-enforced permissions.</p>
                    {permissions.includes('support.reply') && (
                      <div aria-label="Internal support follow-up alerts" style={{padding:12,margin:'8px 0',border:'1px solid #475569',borderRadius:8}}>
                        <strong>Support follow-up inbox</strong>
                        <p style={{fontSize:12,color:'#cbd5e1'}}>Staff-only reminders. Opening an alert marks it read, but does not resolve the case or alter its SLA.</p>
                        {supportAlerts.filter(alert=>!alert.is_read).map(alert=>(
                          <button type="button" key={String(alert.id)} disabled={busy}
                            onClick={()=>void openSupportCase(String(alert.case_id),String(alert.id))}
                            style={{...buttonStyle,width:'auto',background:'#334155',marginRight:8,marginTop:5}}>
                            Review due case · {String(alert.case_id).slice(0,8)}
                          </button>
                        ))}
                        {supportAlertsLoaded && !supportAlerts.some(alert=>!alert.is_read) && <p style={{fontSize:12}}>No unread follow-up reminders.</p>}
                      </div>
                    )}
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {records.map(row=><button type="button" key={String(row.id)} disabled={busy}
                        style={{...buttonStyle,width:'auto',background:'#334155',marginTop:0}}
                        onClick={()=>void openSupportCase(String(row.id))}>Open {String(row.subject||row.id)}</button>)}
                    </div>
                    {supportCase && <div style={{borderTop:'1px solid #334155',paddingTop:12,marginTop:12,display:'grid',gap:8}}>
                      <strong>{String(supportCase.case_number||'Support case')} · {String(supportCase.status||'')}</strong>
                      <p>{String(supportCase.subject||'')}</p>
                      <div style={{maxHeight:360,overflowY:'auto',display:'grid',gap:7}}>
                        {((supportCase.messages||[]) as Array<Record<string,unknown>>).map((entry,i)=>
                          <div key={String(entry.id||i)} style={{background:'#172334',borderRadius:8,padding:10,fontSize:13}}>
                            <strong>{entry.internal?'Internal note':'Conversation'}</strong><div>{String(entry.message||'')}</div>
                          </div>)}
                      </div>
                      {permissions.includes('support.reply') && <>
                        <label>Reply or note<textarea rows={3} maxLength={1000} value={supportReply} onChange={e=>setSupportReply(e.target.value)}
                          style={inputStyle} disabled={busy}/></label>
                        <label style={{display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={supportInternal}
                          onChange={e=>setSupportInternal(e.target.checked)} disabled={busy}/>Internal note (not visible to customer)</label>
                        <button type="button" disabled={busy||!supportReply.trim()} onClick={()=>void sendSupportReply()} style={{...buttonStyle,width:'auto'}}>
                          {supportInternal?'Save internal note':'Send support reply'}</button>
                      </>}
                      {permissions.includes('support.manage') && <>
                        <label>Fresh authenticator code for status change<input type="password" inputMode="numeric" maxLength={6}
                          value={supportStepUp} onChange={e=>setSupportStepUp(e.target.value)} style={inputStyle} disabled={busy}/></label>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                          {['OPEN','IN_PROGRESS','RESOLVED','CLOSED'].filter(x=>x!==supportCase.status).map(status=>
                            <button type="button" key={status} disabled={busy||supportStepUp.length!==6}
                              style={{...buttonStyle,width:'auto',background:'#334155'}} onClick={()=>void updateSupportStatus(status)}>{status.replace('_',' ')}</button>)}
                        </div>
                      </>}
                    </div>}
                  </section>
                );

  return (
    <main style={pageStyle}>
      <section style={panelStyle} aria-labelledby="portal-title">
        <div style={{ color: '#c4b5fd', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' }}>
          TrackMyRMC · Secure Access
        </div>
        <h1 id="portal-title" style={{ margin: '10px 0 6px', fontSize: 30, lineHeight: 1.2 }}>
          {stage === 'authenticated' ? 'Command Center' : stage.startsWith('central-') ? 'Central Admin sign in' : stage === 'authority-login' ? 'Delegated Authority sign in' : 'Verified email sign in'}
        </h1>
        <p style={{ color: '#cbd5e1', lineHeight: 1.6, marginTop: 0 }}>
          {stage === 'authenticated'
            ? 'Your access is restricted to the permissions assigned to your account.'
            : stage.startsWith('central-') ? 'Verify your registered email and authenticator to access the Control Center.' : stage === 'authority-login' ? 'Authority uses a password, authenticator and separate one-hour browser session with scoped permissions. Reloading this page requires signing in again.' : 'Approved staff and first-time Authority accounts use email verification followed by authenticator MFA.'}
        </p>

        {error && <div role="alert" style={{ padding: 12, borderRadius: 8, background: '#451a1a', border: '1px solid #b91c1c', color: '#fecaca', margin: '16px 0' }}>{error}</div>}
        {notice && <div role="status" style={{ padding: 12, borderRadius: 8, background: '#172554', border: '1px solid #3730a3', color: '#dbeafe', margin: '16px 0' }}>{notice}</div>}

        {stage === 'central-login' && (
          <form onSubmit={sendCentralOtp}>
            <label htmlFor="central-email">Approved administrator email</label>
            <input id="central-email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} disabled={busy} />
            <button type="submit" disabled={busy} style={buttonStyle}>Send email verification code</button>
            <button type="button" onClick={() => {setStage('authority-login');setError('');setMfaCode('');}} style={{...buttonStyle,background:'transparent',border:'1px solid #475569'}}>Delegated Authority sign in</button>
            <button type="button" onClick={() => {setAuthorityEnrollment(false);setStage('email');setError('');setMfaCode('');}} style={{...buttonStyle,background:'transparent',border:'1px solid #475569'}}>Plant staff / approved MFA setup</button>
          </form>
        )}

        {stage === 'central-otp' && (
          <form onSubmit={verifyCentralOtp}>
            <label htmlFor="central-otp">Email verification code</label>
            <input id="central-otp" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6}
              value={otp} onChange={e=>setOtp(e.target.value)} style={inputStyle} disabled={busy} />
            <button type="submit" disabled={busy} style={buttonStyle}>Verify email code</button>
            <button type="button" disabled={busy} onClick={restartCentralLogin}
              style={{...buttonStyle,background:'transparent',border:'1px solid #475569'}}>Start over or request a new code</button>
          </form>
        )}

        {((stage === 'central-mfa' && !enrollment) || stage === 'central-recover') && (
          <form onSubmit={verifyCentralMfa}>
            <label htmlFor="central-code">{stage === 'central-recover' ? 'Unused recovery code' : 'Authenticator code'}</label>
            <input id="central-code" autoComplete="one-time-code" required
              inputMode={stage === 'central-recover' ? 'text' : 'numeric'} maxLength={stage === 'central-recover' ? 9 : 6}
              pattern={stage === 'central-recover' ? '[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}' : '[0-9]{6}'}
              value={mfaCode} onChange={e=>setMfaCode(e.target.value)} style={inputStyle} disabled={busy} />
            <button type="submit" disabled={busy} style={buttonStyle}>
              {stage === 'central-recover' ? 'Verify recovery code' : 'Verify authenticator and sign in'}
            </button>
            {stage === 'central-mfa' && (
              <button type="button" disabled={busy} onClick={()=>{setMfaCode('');setError('');setStage('central-recover');}}
                style={{...buttonStyle,background:'transparent',border:'1px solid #475569'}}>Recover with a saved code</button>
            )}
            <button type="button" disabled={busy} onClick={restartCentralLogin}
              style={{...buttonStyle,background:'transparent',border:'1px solid #475569'}}>Start over</button>
          </form>
        )}

        {stage === 'central-recovery-codes' && (
          <form onSubmit={finishCentralEnrollment}>
            <h2 style={{fontSize:19}}>Save your recovery codes</h2>
            <p style={{color:'#cbd5e1'}}>Store these codes securely. Each code can be used once with a verified email to enroll a replacement authenticator.</p>
            <ul style={{display:'grid',gridTemplateColumns:'repeat(2, minmax(0, 1fr))',gap:8}}>
              {centralRecoveryCodes.map(code=><li key={code}><code>{code}</code></li>)}
            </ul>
            <label><input type="checkbox" checked={recoveryCodesSaved} onChange={e=>setRecoveryCodesSaved(e.target.checked)} />
              I have saved the recovery codes
            </label>
            <button type="submit" disabled={busy || !recoveryCodesSaved} style={buttonStyle}>Continue to Control Center</button>
          </form>
        )}

        {stage === 'authority-login' && (
          <form onSubmit={authorityLogin}>
            <label htmlFor="authority-login-email">Approved Authority email</label>
            <input id="authority-login-email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} style={inputStyle} disabled={busy}/>
            <label htmlFor="authority-login-password" style={{display:'block',marginTop:18}}>Account password</label>
            <input id="authority-login-password" type="password" autoComplete="current-password" required minLength={12} maxLength={128}
              value={privilegedPassword} onChange={e=>setPrivilegedPassword(e.target.value)} style={inputStyle} disabled={busy}/>
            <label htmlFor="authority-login-code" style={{display:'block',marginTop:18}}>Authenticator code</label>
            <input id="authority-login-code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={e=>setMfaCode(e.target.value)} style={inputStyle} disabled={busy}/>
            <button type="submit" disabled={busy} style={buttonStyle}>Sign in with password + authenticator</button>
            <button type="button" onClick={()=>{setAuthorityEnrollment(true);setStage('email');setError('');setMfaCode('');}} style={{...buttonStyle,background:'transparent',border:'1px solid #475569'}}>First sign-in: verify email and enroll authenticator</button>
            <button type="button" onClick={()=>{setStage('central-login');setError('');setMfaCode('');}} style={{...buttonStyle,background:'transparent',border:'1px solid #475569'}}>Central Admin sign in</button>
          </form>
        )}

        {stage === 'email' && (
          <form onSubmit={sendEmailOtp}>
            <label htmlFor="email" style={{ display: 'block', marginTop: 18, fontWeight: 650 }}>Registered work email</label>
            <input id="email" name="email" type="email" autoComplete="username" required value={email}
              onChange={(event) => setEmail(event.target.value)} style={inputStyle} disabled={busy} />
            <button type="submit" disabled={busy} style={buttonStyle}>{busy ? 'Sending…' : 'Send email verification code'}</button>
          </form>
        )}

        {stage === 'otp' && (
          <form onSubmit={verifyEmailOtp}>
            <p style={{ color: '#cbd5e1' }}>Verification for <strong>{email}</strong></p>
            <label htmlFor="email-otp" style={{ display: 'block', marginTop: 18, fontWeight: 650 }}>Email verification code</label>
            <input id="email-otp" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" required
              maxLength={12} value={otp} onChange={(event) => setOtp(event.target.value)} style={inputStyle} disabled={busy} />
            <button type="submit" disabled={busy} style={buttonStyle}>{busy ? 'Verifying…' : 'Verify email code'}</button>
            <button type="button" disabled={busy} onClick={() => { setStage('email'); setOtp(''); setError(''); setNotice(''); }}
              style={{ ...buttonStyle, background: 'transparent', border: '1px solid #475569' }}>Use another email</button>
          </form>
        )}

        {(stage === 'mfa-enroll' || stage === 'central-mfa') && enrollment && (
          <form onSubmit={stage === 'central-mfa' ? verifyCentralMfa : confirmEnrollment}>
            <h2 style={{ fontSize: 19 }}>Set up your authenticator</h2>
            <p style={{ color: '#cbd5e1', lineHeight: 1.6 }}>Add <strong>{enrollment.account}</strong> to your authenticator app using the setup key below.</p>
            <label htmlFor="manual-key" style={{ display: 'block', fontWeight: 650 }}>Authenticator setup key</label>
            <textarea id="manual-key" readOnly value={enrollment.manual_key} rows={2}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }} />
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', color: '#c4b5fd' }}>Show otpauth URI</summary>
              <textarea readOnly value={enrollment.otpauth_uri} rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }} />
            </details>
            {stage === 'mfa-enroll' && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 10, border: '1px solid #92400e', background: '#451a03' }}>
              <strong style={{ color: '#fde68a' }}>Save these recovery codes now</strong>
              <p style={{ margin: '6px 0 10px', color: '#fde68a', fontSize: 13 }}>Each code is single-use. This screen will not show them again after setup.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {enrollment.recovery_codes.map((recoveryCode) => (
                  <code key={recoveryCode} style={{ padding: 8, background: '#1c1917', borderRadius: 6, textAlign: 'center' }}>{recoveryCode}</code>
                ))}
              </div>
              <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 12, lineHeight: 1.4 }}>
                <input type="checkbox" checked={recoveryCodesSaved} onChange={(event) => setRecoveryCodesSaved(event.target.checked)} />
                I have saved these recovery codes in a secure place.
              </label>
            </div>
            )}
            <label htmlFor="enroll-code" style={{ display: 'block', marginTop: 18, fontWeight: 650 }}>6-digit authenticator code</label>
            <input id="enroll-code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="[0-9]{6}"
              value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} style={inputStyle} disabled={busy} />
            <button type="submit" disabled={busy || (stage === 'mfa-enroll' && !recoveryCodesSaved)} style={buttonStyle}>{busy ? 'Enabling…' : 'Confirm authenticator setup'}</button>
            {stage === 'central-mfa' && (
              <button type="button" disabled={busy} onClick={restartCentralLogin}
                style={{...buttonStyle,background:'transparent',border:'1px solid #475569'}}>Start over</button>
            )}
          </form>
        )}

        {stage === 'authority-password' && (
          <form onSubmit={completeAuthorityEnrollment}>
            <h2 style={{fontSize:19}}>Set your private Authority password</h2>
            <p style={{color:'#cbd5e1'}}>This one-time step requires your approved work-email challenge and enrolled authenticator. It never signs you into Expo.</p>
            <label htmlFor="authority-initial-password">New password (16-128 characters)</label>
            <input id="authority-initial-password" type="password" autoComplete="new-password" required minLength={16}
              maxLength={128} value={newAuthorityPassword} onChange={e=>setNewAuthorityPassword(e.target.value)}
              style={inputStyle} disabled={busy}/>
            <label htmlFor="authority-confirm-password" style={{display:'block',marginTop:14}}>Confirm password</label>
            <input id="authority-confirm-password" type="password" autoComplete="new-password" required minLength={16}
              maxLength={128} value={confirmAuthorityPassword} onChange={e=>setConfirmAuthorityPassword(e.target.value)}
              style={inputStyle} disabled={busy}/>
            <label htmlFor="authority-enrollment-code" style={{display:'block',marginTop:14}}>Current authenticator code</label>
            <input id="authority-enrollment-code" inputMode="numeric" autoComplete="one-time-code" required
              pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={e=>setMfaCode(e.target.value)}
              style={inputStyle} disabled={busy}/>
            <button type="submit" disabled={busy} style={buttonStyle}>Finish Authority enrollment</button>
          </form>
        )}

        {stage === 'mfa-login' && (
          <form onSubmit={verifyMfa}>
            <label htmlFor="mfa-code" style={{ display: 'block', marginTop: 18, fontWeight: 650 }}>Authenticator or recovery code</label>
            <input id="mfa-code" type="text" autoComplete="one-time-code" required maxLength={16}
              value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} style={inputStyle} disabled={busy} />
            <button type="submit" disabled={busy} style={buttonStyle}>{busy ? 'Verifying…' : 'Verify MFA and sign in'}</button>
            <button type="button" onClick={()=>{setStage('authority-login');setMfaCode('');setChallengeToken('');setError('');}}
              style={{...buttonStyle,background:'transparent',border:'1px solid #475569'}}>Authority enrolled? Continue to dedicated Authority sign in</button>
          </form>
        )}

        {stage === 'authenticated' && user && (
          <div>
            <div style={{ marginTop: 20, padding: 16, border: '1px solid #334155', borderRadius: 10, background: '#111827',
              display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:8 }}>
              <p style={{ margin: '0 0 8px' }}><strong>Signed in as</strong> {user.full_name || user.email || user.phone || 'Staff user'}</p>
              <p style={{ margin: '0 0 8px' }}><strong>Role</strong> {user.role}</p>
              <p style={{ margin: 0 }}><strong>Session</strong> {user.role === 'central_admin' || user.role === 'authority' ? 'Dedicated one-hour web authenticator session' : 'Email OTP + MFA verified'}</p>
            </div>
            {user.role === 'authority' && (
              <details style={{marginTop:14,padding:14,border:'1px solid #334155',borderRadius:10}}>
                <summary style={{cursor:'pointer',fontWeight:700}}>Account security · Change password</summary>
                <p style={{fontSize:12,color:'#cbd5e1'}}>Requires your current password, authenticator and audit reason. Every session will be revoked.</p>
                <form onSubmit={rotateWebPassword}>
                  <label htmlFor="rotate-current">Current password</label>
                  <input id="rotate-current" type="password" autoComplete="current-password" required
                    value={oldWebPassword} onChange={e=>setOldWebPassword(e.target.value)} style={inputStyle} disabled={busy}/>
                  <label htmlFor="rotate-new" style={{display:'block',marginTop:12}}>New password (16-128 characters)</label>
                  <input id="rotate-new" type="password" autoComplete="new-password" required minLength={16} maxLength={128}
                    value={newWebPassword} onChange={e=>setNewWebPassword(e.target.value)} style={inputStyle} disabled={busy}/>
                  <label htmlFor="rotate-confirm" style={{display:'block',marginTop:12}}>Confirm new password</label>
                  <input id="rotate-confirm" type="password" autoComplete="new-password" required minLength={16} maxLength={128}
                    value={newWebPasswordConfirm} onChange={e=>setNewWebPasswordConfirm(e.target.value)} style={inputStyle} disabled={busy}/>
                  <label htmlFor="rotate-code" style={{display:'block',marginTop:12}}>Current authenticator code</label>
                  <input id="rotate-code" type="password" inputMode="numeric" autoComplete="one-time-code" required
                    maxLength={6} pattern="[0-9]{6}" value={rotationCode} onChange={e=>setRotationCode(e.target.value)}
                    style={inputStyle} disabled={busy}/>
                  <label htmlFor="rotate-reason" style={{display:'block',marginTop:12}}>Reason (10-500 characters)</label>
                  <textarea id="rotate-reason" required minLength={10} maxLength={500} rows={2}
                    value={rotationReason} onChange={e=>setRotationReason(e.target.value)} style={inputStyle} disabled={busy}/>
                  <button type="submit" style={buttonStyle} disabled={busy}>Rotate password and sign out everywhere</button>
                </form>
              </details>
            )}
            <div style={{ marginTop: 14, padding: 16, border: '1px solid #334155', borderRadius: 10 }}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>Service health</h2>
              <p><strong>API:</strong> {health?.status || 'Unavailable'}</p>
              <p><strong>Database:</strong> {health?.database || 'Not confirmed'}</p>
              <p><strong>Environment:</strong> {health?.environment || 'Unknown'}</p>
              <p style={{ color: '#94a3b8', fontSize: 12 }}>This portal is being connected incrementally to secured Rust APIs. Privileged actions require recent authenticator verification.</p>
            </div>
            {user.role === 'central_admin' && (
              <nav aria-label="Control Center sections" style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:14}}>
                {([
                  ['#platform-overview','Platform KPIs'],
                  ['#automation-governance','Automation'],
                  ['#authority-governance','Authority'],
                  ['#operations-workspaces','Operations & Marketing'],
                ] as const).map(([href,label])=><a key={href} href={href}
                  style={{padding:'9px 13px',borderRadius:8,color:'#f8fafc',background:'#25364e',
                    border:'1px solid #475569',textDecoration:'none',fontSize:13,fontWeight:650}}>{label}</a>)}
              </nav>
            )}
            {user.role === 'central_admin' && (
              <section id="platform-overview" aria-label="Platform overview" style={{ marginTop: 14, padding: 16, border: '1px solid #334155', borderRadius: 10 }}>
                <h2 style={{ marginTop: 0, fontSize: 18 }}>Live platform overview</h2>
                {adminOverviewError && <p role="alert" style={{ color: '#fecaca' }}>Unable to load overview: {adminOverviewError}</p>}
                {!adminOverviewError && adminKpis.length === 0 && <p style={{ color: '#94a3b8' }}>No overview data available.</p>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
                  {adminKpis.map((item) => (
                    <div key={item.label} style={{ padding: 12, border: '1px solid #475569', borderRadius: 8, background: '#111827' }}>
                      <div style={{ color: '#cbd5e1', fontSize: 12 }}>{item.label}</div>
                      <strong style={{ fontSize: 22 }}>{String(item.value)}</strong>
                    </div>
                  ))}
                </div>
                <p style={{ color: '#94a3b8', fontSize: 12 }}>Read-only statistics from the Rust API. This is not the complete reference Control Center.</p>
              </section>
            )}
            {user.role === 'central_admin' && permissions.includes('system.view') && (
              <section id="automation-governance" aria-label="Native automation governance" style={{marginTop:18,padding:14,border:'1px solid #334155',borderRadius:10}}>
                <h2 style={{marginTop:0,fontSize:19}}>Native Automation Center</h2>
                <p style={{fontSize:12,color:'#cbd5e1'}}>TrackMyRMC-owned Rust workflows. Central policy is separate from each Plant Owner's activation.</p>
                <button type="button" disabled={busy} onClick={()=>void loadNativeAutomation()} style={buttonStyle}>
                  {showNativeAutomation ? 'Refresh automation health and templates' : 'Open Automation Center'}
                </button>
                {showNativeAutomation && <>
                  <p><strong>Internal worker:</strong> {automationHealth?.worker_enabled ? 'Configured on this API' : 'Disabled (safe default)'}</p>
                  <p><strong>Heartbeat:</strong> {automationHealth?.heartbeat?.recent ? 'Recent worker heartbeat' : 'No recent verified worker heartbeat'}</p>
                  <p style={{fontSize:12,color:'#cbd5e1'}}>Queue status: {(automationHealth?.job_counts||[]).map(item=>`${item.status}: ${item.count}`).join(' · ') || 'No jobs recorded'}</p>
                  {!permissions.includes('automation.manage') && <p style={{color:'#fbbf24',fontSize:12}}>
                    Read-only access. Automation policy changes require separately approved automation.manage access.
                  </p>}
                  {permissions.includes('automation.manage') && <>
                    <label htmlFor="automation-mfa">Fresh authenticator code (required before each change)</label>
                    <input id="automation-mfa" autoComplete="off" type="password" value={automationCode}
                      onChange={e=>setAutomationCode(e.target.value)} style={inputStyle}/>
                  </>}
                  <div style={{display:'grid',gap:10,marginTop:14}}>
                    {automationTemplates.map(template=><div key={template.key} style={{border:'1px solid #475569',borderRadius:9,padding:12}}>
                      <strong>{template.label}</strong>
                      <p style={{color:'#cbd5e1',fontSize:12,margin:'7px 0'}}>
                        {template.event_type} · Version {template.version} · {template.enabled_plants} plant opt-ins
                      </p>
                      <p style={{fontSize:12,margin:'6px 0'}}>Policy: {!template.published ? 'Unpublished' : template.globally_paused ? 'Paused' : 'Published and active'}</p>
                      {permissions.includes('automation.manage') && <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                        <button type="button" disabled={busy || template.globally_paused}
                          onClick={()=>void updateAutomationPolicy(template,template.published,true)}
                          style={{...buttonStyle,width:'auto',marginTop:4,background:'#9a3412'}}>Emergency pause</button>
                        <button type="button" disabled={busy || (template.published && !template.globally_paused)}
                          onClick={()=>void updateAutomationPolicy(template,true,false)}
                          style={{...buttonStyle,width:'auto',marginTop:4,background:'#166534'}}>Publish and resume</button>
                        <button type="button" disabled={busy || (!template.published && template.globally_paused)}
                          onClick={()=>void updateAutomationPolicy(template,false,true)}
                          style={{...buttonStyle,width:'auto',marginTop:4,background:'#475569'}}>Unpublish</button>
                      </div>}
                    </div>)}
                  </div>
                  {permissions.includes('automation.manage') && automationTemplates.length>0 && <div style={{border:'1px solid #475569',padding:12,borderRadius:9,marginTop:12}}>
                    <h3 style={{marginTop:0}}>Edit bounded order conditions</h3>
                    <p style={{fontSize:12,color:'#cbd5e1'}}>Only paused templates can be changed. Unknown fields, scripts and URLs are not supported.</p>
                    <label htmlFor="automation-key">Rule</label>
                    <select id="automation-key" style={inputStyle} value={automationKey} onChange={e=>setAutomationKey(e.target.value)}>
                      {automationTemplates.map(template=><option value={template.key} key={template.key}>{template.label}</option>)}
                    </select>
                    <label htmlFor="automation-min">Minimum quantity (m³, optional)</label>
                    <input id="automation-min" type="number" min={0} max={100000} step="any" style={inputStyle}
                      value={automationMin} onChange={e=>setAutomationMin(e.target.value)} />
                    <label htmlFor="automation-max">Maximum quantity (m³, optional)</label>
                    <input id="automation-max" type="number" min={0} max={100000} step="any" style={inputStyle}
                      value={automationMax} onChange={e=>setAutomationMax(e.target.value)}/>
                    <label htmlFor="automation-grades">Allowed concrete grades (comma-separated, empty = all)</label>
                    <input id="automation-grades" style={inputStyle} value={automationGrades} onChange={e=>setAutomationGrades(e.target.value)}/>
                    <button type="button" disabled={busy || !automationTemplates.find(item=>item.key===automationKey)?.globally_paused}
                      style={buttonStyle} onClick={()=>void updateAutomationConditions()}>Save and version rule</button>
                  </div>}
                  {permissions.includes('audit.view') && <div style={{marginTop:14}}>
                    <h3>Recent execution history</h3>
                    <p style={{fontSize:12,color:'#cbd5e1'}}>Global governance shows status only, without private plant or order details.</p>
                    {automationJobs.slice(0,12).map(job=><div key={job.id} style={{borderTop:'1px solid #334155',padding:'8px 0'}}>
                      <div style={{fontSize:12}}>{job.template_key} · {job.status} · {job.attempts} attempts</div>
                      {job.status==='DEAD_LETTER' && permissions.includes('automation.manage') &&
                        <button type="button" disabled={busy} onClick={()=>void retryNativeAutomationJob(job.id)}
                          style={{...buttonStyle,width:'auto',marginTop:5}}>MFA retry dead letter</button>}
                    </div>)}
                    {!automationJobs.length && <p style={{fontSize:12,color:'#94a3b8'}}>No executions recorded.</p>}
                  </div>}
                </>}
              </section>
            )}

            {user.role === 'central_admin' && permissions.includes('admin_access.manage') && (
              <section id="authority-governance" aria-label="Authority governance" style={{marginTop:18,padding:16,border:'1px solid #334155',borderRadius:12}}>
                <h2 style={{margin:'0 0 6px',fontSize:19}}>Authority Access Governance</h2>
                <p style={{fontSize:13,color:'#cbd5e1',lineHeight:1.5}}>
                  Issue or revoke separate web-only Authority identities. Delegation never grants Central Admin,
                  payments, reviewer settings, platform automation policy or session administration.
                </p>
                <button type="button" disabled={busy} onClick={()=>void loadAuthorityAccounts()} style={buttonStyle}>
                  {showAuthorityAccounts?'Refresh Authority accounts':'Manage Authority accounts'}
                </button>
                {showAuthorityAccounts && <>
                  <div style={{display:'grid',gap:9,margin:'12px 0'}}>
                    {authorityAccounts.map(account=><article key={account.id} style={{border:'1px solid #475569',borderRadius:10,padding:12,background:'#111827'}}>
                      <strong>{account.full_name}</strong><div style={{fontSize:13,color:'#cbd5e1'}}>{account.email}</div>
                      <div style={{fontSize:12,marginTop:5}}>{account.enabled?'Approved':'Disabled'} · MFA {account.mfa_enrolled?'enrolled':'not enrolled'} · {account.permissions.join(', ')||'No grants'}</div>
                      <button type="button" disabled={busy} onClick={()=>{
                        setAuthorityEmail(account.email||'');setAuthorityName(account.full_name||'');
                        setAuthorityEnabled(account.enabled);setAuthorityGrants(account.permissions);
                        setAuthorityReason('');setAuthorityAdminCode('');
                      }} style={{...buttonStyle,width:'auto',background:'#334155'}}>Edit delegation</button>
                    </article>)}
                    {!authorityAccounts.length && <p>No Authority accounts provisioned. Create an approved identity below.</p>}
                  </div>
                  <form onSubmit={saveAuthorityAccount} style={{display:'grid',gap:10}}>
                    <h3 style={{fontSize:16,margin:'6px 0'}}>Issue / update Authority access</h3>
                    <label>Work email<input required type="email" autoComplete="off" value={authorityEmail}
                      onChange={e=>setAuthorityEmail(e.target.value)} style={inputStyle} disabled={busy}/></label>
                    <label>Full name<input required minLength={2} maxLength={100} value={authorityName}
                      onChange={e=>setAuthorityName(e.target.value)} style={inputStyle} disabled={busy}/></label>
                    <label style={{display:'flex',gap:9,alignItems:'center'}}>
                      <input type="checkbox" checked={authorityEnabled} onChange={e=>setAuthorityEnabled(e.target.checked)} disabled={busy}/>
                      Approved / active
                    </label>
                    <fieldset style={{border:'1px solid #475569',borderRadius:8,display:'grid',gap:7}}>
                      <legend>Explicit delegation</legend>
                      {AUTHORITY_GRANTS.map(grant=><label key={grant.key} style={{display:'flex',gap:9,alignItems:'center',fontSize:13}}>
                        <input type="checkbox" checked={authorityGrants.includes(grant.key)} disabled={busy}
                          onChange={e=>setAuthorityGrants(old=>e.target.checked?[...old,grant.key]:old.filter(p=>p!==grant.key))}/>
                        {grant.label}
                      </label>)}
                    </fieldset>
                    <label>Reason for access change<input required minLength={10} maxLength={500} value={authorityReason}
                      onChange={e=>setAuthorityReason(e.target.value)} style={inputStyle} disabled={busy}/></label>
                    <label>Fresh Central Admin authenticator code<input required inputMode="numeric" pattern="[0-9]{6}"
                      maxLength={6} type="password" value={authorityAdminCode} onChange={e=>setAuthorityAdminCode(e.target.value)}
                      style={inputStyle} autoComplete="off" disabled={busy}/></label>
                    <button type="submit" disabled={busy} style={buttonStyle}>Save grants and revoke previous sessions</button>
                  </form>
                  <p style={{fontSize:12,color:'#94a3b8'}}>
                    First-time Authority login: use the approved email to enroll an authenticator on this web portal,
                    then sign in via Delegated Authority. Never share authenticator recovery codes.
                  </p>
                </>}
              </section>
            )}

            {user.role === 'central_admin' && <section id="operations-workspaces" aria-label="Authorized workspaces" style={{marginTop:18}}>

              {permissions.includes('plant_owners.manage') && permissions.includes('plant.view') && <>
                <button onClick={()=>void loadPlantProfileQueue()} disabled={busy} style={buttonStyle}>Plant Profile · Verification Queue</button>
                {showPlantProfiles && <section aria-label="Plant profile verification" style={{display:'grid',gap:12,marginTop:12,marginBottom:18}}>
                  <p style={{color:'#cbd5e1'}}>Review owner-submitted data and uploaded certificates before publishing. Unapproved information is never exposed to customers.</p>
                  <label>Fresh authenticator code<input type="password" autoComplete="off" value={plantProfileCode}
                    onChange={e=>setPlantProfileCode(e.target.value)} style={inputStyle}/></label>
                  <label>Review note / rejection reason<input maxLength={500} value={plantProfileReason}
                    onChange={e=>setPlantProfileReason(e.target.value)} style={inputStyle}/></label>
                  {plantProfileQueue.map(item=>{
                    const plant=String(item.plant_id);
                    const section=String(item.section);
                    const data=(item.answers||{}) as Record<string,string>;
                    return <article key={plant+':'+section} style={{padding:14,borderRadius:10,border:'1px solid #475569'}}>
                      <h3>{String(item.plant_name)} — {section.replace(/_/g,' ')}</h3>
                      <p>Pending submission · Revision {String(item.revision||'—')}</p>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:8}}>
                        {Object.entries(data).filter(([key])=>!key.endsWith('_document')).map(([key,value])=>
                          <div key={key} style={{padding:8,background:'#111827',borderRadius:6}}>
                            <small style={{color:'#94a3b8'}}>{key.replace(/_/g,' ')}</small><div>{String(value)}</div>
                          </div>)}
                      </div>
                      {section==='certifications' && <div style={{display:'flex',gap:7,flexWrap:'wrap',marginTop:10}}>
                        {['cte','cto','qci','bis','license'].filter(cert=>data[cert]==='yes'&&data[cert+'_document'])
                          .map(cert=><button key={cert} type="button" style={{...buttonStyle,width:'auto'}}
                            onClick={()=>void reviewPlantCertificate(plant,cert)}>Review {cert.toUpperCase()} evidence</button>)}
                      </div>}
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
                        <button disabled={busy} style={{...buttonStyle,width:'auto',background:'#166534'}}
                          onClick={()=>void decidePlantProfile(plant,section,true)}>Approve & Publish</button>
                        <button disabled={busy} style={{...buttonStyle,width:'auto',background:'#991b1b'}}
                          onClick={()=>void decidePlantProfile(plant,section,false)}>Reject / Request Changes</button>
                      </div>
                    </article>;
                  })}
                  {!plantProfileQueue.length && <p>No pending Plant Profile submissions.</p>}
                </section>}
              </>}
              {permissions.includes('plant_owners.manage') && <>
                <button onClick={()=>void loadOwnerRequests()} disabled={busy} style={buttonStyle}>Plant Owner approvals and access</button>
                {showOwners && <section aria-label="Plant Owner access controls" style={{display:'grid',gap:12,marginTop:12}}>
                  <label>Fresh authenticator code<input type="password" autoComplete="off" value={ownerCode} onChange={e=>setOwnerCode(e.target.value)} style={inputStyle}/></label>
                  <label>Reason for privileged change<input maxLength={500} value={ownerReason} onChange={e=>setOwnerReason(e.target.value)} style={inputStyle}/></label>
                  {ownerRequests.map(row=>{
                    const id=String(row.id);const fields=ownerFields[id]||{city:String(row.city||''),state:String(row.state||''),pincode:''};
                    return <article key={id} style={{border:'1px solid #475569',padding:12}}>
                      <h3>{String(row.name)} · {String(row.request_number)}</h3><p>{String(row.applicant_email)} · {String(row.address)}</p>
                      {(['city','state','pincode'] as const).map(key=><label key={key}>{key}<input value={fields[key]} onChange={e=>setOwnerFields(old=>({...old,[id]:{...fields,[key]:e.target.value}}))} style={inputStyle}/></label>)}
                      <button disabled={busy} onClick={()=>void ownerAction('/api/plant-discovery/requests/'+id+'/approve',fields)} style={buttonStyle}>Approve Plant Owner and plant</button>
                      <button disabled={busy} onClick={()=>void ownerAction('/api/plant-discovery/requests/'+id+'/reject',{})} style={buttonStyle}>Reject request</button>
                    </article>;
                  })}
                  {!ownerRequests.length && <p>No pending Plant Owner requests.</p>}
                  <label>Registered Plant Owner account ID<input value={ownerId} onChange={e=>setOwnerId(e.target.value)} style={inputStyle}/></label>
                  <button disabled={busy || !ownerId} onClick={()=>void ownerAction('/api/control-center/owners/'+encodeURIComponent(ownerId)+'/status',{active:false})} style={buttonStyle}>Suspend / revoke Owner access</button>
                  <button disabled={busy || !ownerId} onClick={()=>void ownerAction('/api/control-center/owners/'+encodeURIComponent(ownerId)+'/status',{active:true})} style={buttonStyle}>Reactivate approved Owner</button>
                </section>}
              </>}
              <nav style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {['users','plants','orders','support','service_enquiries','rmc_rfq_leads','kyc','audit','sessions'].filter(kind=>permissions.includes(({users:'user.view',plants:'plant.view',orders:'order.view',support:'support.view',service_enquiries:'support.view',rmc_rfq_leads:'support.view',kyc:'kyc.view',audit:'audit.view',sessions:'session.view'} as Record<string,string>)[kind])).map(kind=>
                  <button key={kind} disabled={busy} onClick={()=>void loadWorkspace(kind)} style={{...buttonStyle,width:'auto',textTransform:'capitalize'}}>{kind}</button>)}
              </nav>
              {workspace && <><h2 style={{textTransform:'capitalize'}}>{workspace}</h2>
                {workspaceFeedback}
                <div style={{overflowX:'auto'}}><table style={{width:'100%',fontSize:13,borderCollapse:'collapse'}}>
                  <thead><tr>{Object.keys(records[0]||{}).map(key=><th key={key} style={{textAlign:'left',padding:8}}>{key.replace(/_/g,' ')}</th>)}</tr></thead>
                  <tbody>{records.map((row,index)=><tr key={String(row.id||index)}>{Object.entries(row).map(([key,value])=><td key={key} style={{padding:8,borderTop:'1px solid #334155'}}>{value===null?'—':typeof value==='object'?JSON.stringify(value):String(value)}</td>)}</tr>)}</tbody>
                </table></div>
                {supportWorkspace}
                {workspace === 'service_enquiries' && permissions.includes('support.manage') && (
                  <section aria-label="Service enquiry approvals" style={{border:'1px solid #475569',borderRadius:12,padding:14,marginTop:14,display:'grid',gap:10}}>
                    <h3 style={{fontSize:16}}>Service Enquiry Follow-up</h3>
                    <label>Required audit reason<input maxLength={500} minLength={10} value={serviceReason} onChange={e=>setServiceReason(e.target.value)} style={inputStyle} disabled={busy}/></label>
                    <label>Fresh authenticator code<input type="password" maxLength={6} value={serviceStepUp} onChange={e=>setServiceStepUp(e.target.value)} style={inputStyle} disabled={busy}/></label>
                    {records.map(row=><div key={String(row.id)} style={{padding:10,border:'1px solid #334155',borderRadius:8}}>
                      <strong>{String(row.service_type||'Service')} · {String(row.status||'NEW')}</strong>
                      <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>
                        {['CONTACTED','QUOTED','CLOSED'].filter(x=>x!==row.status).map(status=>
                          <button key={status} type="button" disabled={busy||serviceReason.trim().length<10||serviceStepUp.length!==6}
                            onClick={()=>void updateServiceEnquiry(String(row.id),status)}
                            style={{...buttonStyle,width:'auto',background:'#334155'}}>{status}</button>)}
                      </div>
                    </div>)}
                  </section>
                )}
                {workspace === 'kyc' && permissions.includes('kyc.review') && <div style={{marginTop:18,display:'grid',gap:12,border:'1px solid #475569',borderRadius:10,padding:14}}>
                  <h3 style={{fontSize:16,margin:0}}>Customer Identity Review</h3>
                  <p style={{fontSize:12,color:'#cbd5e1'}}>Approve only where the backend confirms provider consent and a verified name. Rejection and reset require an audit reason.</p>
                  <label>Reason for review<input required minLength={10} maxLength={500} value={centralKycReason}
                    onChange={e=>setCentralKycReason(e.target.value)} style={inputStyle} disabled={busy}/></label>
                  <label>Fresh Central Admin authenticator code<input type="password" autoComplete="off" inputMode="numeric"
                    pattern="[0-9]{6}" maxLength={6} value={centralKycCode} onChange={e=>setCentralKycCode(e.target.value)}
                    style={inputStyle} disabled={busy}/></label>
                  {records.map(row=><article key={String(row.customer_id)} style={{borderTop:'1px solid #475569',padding:12}}>
                    <strong>{String(row.customer||'Customer')}</strong>
                    <p style={{fontSize:12,color:'#cbd5e1'}}>Provider-verified name: {String(row.verified_name||'Not confirmed')} · Consent evidence: {row.evidence_verified?'Recorded':'Missing'}</p>
                    <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                      <button type="button" disabled={busy||!row.evidence_verified||!row.verified_name||centralKycReason.length<10||centralKycCode.length!==6}
                        onClick={()=>void reviewCentralKyc(String(row.customer_id),'approve')}
                        style={{...buttonStyle,width:'auto',background:'#166534'}}>Approve verified identity</button>
                      <button type="button" disabled={busy||centralKycReason.length<10||centralKycCode.length!==6}
                        onClick={()=>void reviewCentralKyc(String(row.customer_id),'reject')}
                        style={{...buttonStyle,width:'auto',background:'#7f1d1d'}}>Reject</button>
                    </div>
                  </article>)}
                </div>}
                {workspace === 'rmc_rfq_leads' && permissions.includes('support.manage') && <div style={{marginTop:18,display:'grid',gap:12}}>
                  <p style={{color:'#cbd5e1',lineHeight:1.5}}>
                    Unregistered suppliers have not received these enquiries. Use approved, permission-based outreach.
                    Customer details remain private until plant approval and customer reconfirmation.
                  </p>
                  <label htmlFor="rfq-step-up">Fresh authenticator code to record outreach</label>
                  <input id="rfq-step-up" value={rfqOutreachCode} onChange={e=>setRfqOutreachCode(e.target.value)}
                    autoComplete="off" type="password" style={inputStyle} disabled={busy} />
                  <button type="button" disabled={busy} onClick={()=>void shareRmcOnboardingLink()}
                    style={{...buttonStyle,background:'#166534'}}>Share or Copy Generic Onboarding Link</button>
                  {records.filter(row=>row.status === 'PENDING_SUPPLIER').map(row=>{
                    const id=String(row.id || '');
                    const place=String(row.google_place_id || '');
                    return <div key={id} style={{border:'1px solid #475569',borderRadius:12,padding:14,background:'#0f172a',display:'grid',gap:8}}>
                      <strong>{String(row.customer_name || 'Customer')} · {String(row.grade || 'RMC')} · {String(row.quantity_m3 || '')} m³</strong>
                      <span>Current outreach: {String(row.outreach_status || 'NOT_CONTACTED')}</span>
                      {place && <button type="button" disabled={busy}
                        onClick={()=>window.open('https://www.google.com/maps/search/?api=1&query=RMC%20Plant&query_place_id='+encodeURIComponent(place),'_blank','noopener,noreferrer')}
                        style={{...buttonStyle,marginTop:0,background:'#334155'}}>View Selected Supplier on Google Maps</button>}
                      <label>Internal follow-up note
                        <input value={rfqOutreachNotes[id] ?? String(row.outreach_notes || '')}
                          onChange={e=>setRfqOutreachNotes(prev=>({...prev,[id]:e.target.value}))} maxLength={1000}
                          style={inputStyle} disabled={busy} />
                      </label>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <button type="button" disabled={busy} onClick={()=>void recordRfqOutreach(id,'INVITATION_SHARED')} style={{...buttonStyle,width:'auto',marginTop:0}}>Record Invite Shared</button>
                        <button type="button" disabled={busy} onClick={()=>void recordRfqOutreach(id,'CONTACTED')} style={{...buttonStyle,width:'auto',marginTop:0,background:'#166534'}}>Mark Contacted</button>
                        <button type="button" disabled={busy} onClick={()=>void recordRfqOutreach(id,'DECLINED')} style={{...buttonStyle,width:'auto',marginTop:0,background:'#7f1d1d'}}>Mark Declined</button>
                      </div>
                    </div>;
                  })}
                </div>}
                <button disabled={busy||workspaceOffset===0} onClick={()=>void loadWorkspace(workspace,Math.max(0,workspaceOffset-25))}>Previous</button>
                <button disabled={busy||records.length<25} onClick={()=>void loadWorkspace(workspace,workspaceOffset+25)}>Next</button>
              </>}
            </section>}
            {user.role === 'authority' && (
              <section aria-label="Delegated Authority Operations" style={{marginTop:18,padding:16,border:'1px solid #334155',borderRadius:12}}>
                <h2 style={{margin:'0 0 8px',fontSize:20}}>Authority Operations</h2>
                <p style={{fontSize:13,color:'#cbd5e1',lineHeight:1.55}}>
                  Centrally delegated service operations only. Platform policy, financial mutations,
                  staff role elevation, automation settings and Central Admin access remain restricted.
                </p>
                <h3 style={{fontSize:15}}>Authorized service workspaces</h3>
                <nav aria-label="Authority workspaces" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:8}}>
                  {([
                    ['users','user.view','User Directory'],
                    ['plants','plant.view','Approved Plants'],
                    ['orders','order.view','Order Monitoring'],
                    ['support','support.view','Customer Support'],
                    ['service_enquiries','support.view','Service Enquiries'],
                    ['rmc_rfq_leads','support.view','RFQ / Marketing Leads'],
                    ['kyc','kyc.view','KYC Review Queue'],
                  ] as const).filter(([,permission])=>permissions.includes(permission)).map(([kind,,label])=>
                    <button key={kind} type="button" disabled={busy} onClick={()=>void loadWorkspace(kind)}
                      style={{...buttonStyle,marginTop:0,background:workspace===kind?'#166534':'#334155'}}>{label}</button>)}
                </nav>
                {workspace && <>
                  <h3 style={{margin:'18px 0 6px',fontSize:16,textTransform:'capitalize'}}>{workspace.replace(/_/g,' ')}</h3>
                  <p style={{fontSize:12,color:'#94a3b8'}}>Current permission-scoped records. This view cannot broadcast to customers or suppliers.</p>
                  <div style={{overflowX:'auto',border:'1px solid #334155',borderRadius:8}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                      <thead><tr>{Object.keys(records[0]||{}).map(key=>
                        <th key={key} scope="col" style={{textAlign:'left',padding:9,borderBottom:'1px solid #475569'}}>{key.replace(/_/g,' ')}</th>)}</tr></thead>
                      <tbody>{records.map((row,index)=><tr key={String(row.id||row.customer_id||index)}>
                        {Object.entries(row).map(([key,value])=>
                          <td key={key} style={{padding:9,borderTop:'1px solid #334155'}}>{value===null?'—':typeof value==='object'?JSON.stringify(value):String(value)}</td>)}
                      </tr>)}</tbody>
                    </table>
                  </div>
                  {workspaceFeedback}
                  {supportWorkspace}
                  {workspace==='kyc' && permissions.includes('kyc.review') && records.length>0 && (
                    <div style={{marginTop:12,padding:12,border:'1px solid #475569',borderRadius:10}}>
                      <h3 style={{fontSize:15}}>Customer verification decisions</h3>
                      <p style={{fontSize:12,color:'#cbd5e1'}}>Review trusted evidence under the approved KYC process before making a decision. Each change requires recent authenticator verification.</p>
                      <label>Fresh Authority authenticator code<input type="password" autoComplete="off"
                        inputMode="numeric" maxLength={6} pattern="[0-9]{6}" value={authorityReviewCode}
                        onChange={e=>setAuthorityReviewCode(e.target.value)} style={inputStyle} disabled={busy}/></label>
                      <label>Decision reason for the audit log (10-500 characters)
                        <textarea maxLength={500} rows={2} value={authorityReviewReason}
                          onChange={e=>setAuthorityReviewReason(e.target.value)} style={inputStyle} disabled={busy}/>
                      </label>
                      {records.map(row=><div key={String(row.customer_id)} style={{borderTop:'1px solid #334155',padding:'10px 0'}}>
                        <strong>{String(row.customer||'Customer')}</strong>
                        <p style={{fontSize:12}}>Verified name: {String(row.verified_name||'Missing')} · Provider evidence: {row.evidence_verified?'Confirmed':'Not confirmed'}</p>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                          <button type="button" disabled={busy||authorityReviewCode.length!==6||authorityReviewReason.trim().length<10||!row.evidence_verified||!row.verified_name}
                            onClick={()=>void reviewAuthorityKyc(String(row.customer_id),true)}
                            style={{...buttonStyle,width:'auto',background:'#166534'}}>Approve KYC</button>
                          <button type="button" disabled={busy||authorityReviewCode.length!==6||authorityReviewReason.trim().length<10}
                            onClick={()=>void reviewAuthorityKyc(String(row.customer_id),false)}
                            style={{...buttonStyle,width:'auto',background:'#7f1d1d'}}>Reject KYC</button>
                        </div>
                      </div>)}
                    </div>
                  )}
                  <div style={{display:'flex',gap:10}}>
                    <button type="button" disabled={busy||workspaceOffset===0} onClick={()=>void loadWorkspace(workspace,Math.max(0,workspaceOffset-25))}>Previous</button>
                    <button type="button" disabled={busy||records.length<25} onClick={()=>void loadWorkspace(workspace,workspaceOffset+25)}>Next</button>
                  </div>
                </>}
              </section>
            )}
            <button type="button" onClick={()=>void logout()} disabled={busy} style={buttonStyle}>{busy ? 'Signing out…' : 'Sign out and revoke session'}</button>
          </div>
        )}

        <p style={{ margin: '24px 0 0', borderTop: '1px solid #334155', paddingTop: 16, color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
          Never share verification codes or recovery codes. Admin and staff password-only login is disabled.
        </p>
      </section>
    </main>
  );
}

function App() {
  const [sessionKey, setSessionKey] = useState(0);
  const [signOutNotice, setSignOutNotice] = useState('');
  return <CommandCenter key={sessionKey} initialNotice={signOutNotice} onSignedOut={message => {
    setSignOutNotice(message);
    setSessionKey(value => value + 1);
  }} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
