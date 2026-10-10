import React, { useEffect, useState } from 'react';
import { Github, RefreshCw, ExternalLink, GitBranch, FileCode2, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

type Repo = { id: number; full_name: string; private: boolean; default_branch: string; html_url: string; permissions: { push: boolean; pull: boolean } };

export function GitHubConnector() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<{connected:boolean; login?:string} | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState('');
  const [filePath, setFilePath] = useState('README.md');
  const [fileContent, setFileContent] = useState('');
  const [fileSha, setFileSha] = useState('');
  const [commitMessage, setCommitMessage] = useState('Update file from Manus Remix');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);

  const api = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'GitHub request failed');
    return data;
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const s = await api('/.netlify/functions/github-api?action=status');
      setStatus(s);
      if (s.connected) {
        const list = await api('/.netlify/functions/github-api?action=repos') as Repo[];
        setRepos(list);
        if (!selected && list.length) setSelected(list[0].full_name);
      }
    } catch { setStatus({ connected: false }); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    refresh();
    const params = new URLSearchParams(window.location.search);
    if (params.get('github') === 'connected') {
      toast.success('GitHub connected');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const readFile = async () => {
    if (!selected || !filePath.trim()) return;
    setBusy(true);
    try {
      const data = await api(`/.netlify/functions/github-api?action=contents&repo=${encodeURIComponent(selected)}&path=${encodeURIComponent(filePath)}&ref=${encodeURIComponent(branch || repos.find(r => r.full_name === selected)?.default_branch || 'main')}`);
      if (Array.isArray(data) || data.type !== 'file') throw new Error('Selected path is not a text file.');
      const decoded = data.encoding === 'base64' ? atob(data.content.replace(/\\n/g, '')) : data.content;
      setFileContent(decoded);
      setFileSha(data.sha || '');
      toast.success('File loaded');
    } catch (e:any) { toast.error(e.message || 'Could not read file'); }
    finally { setBusy(false); }
  };

  const saveFile = async () => {
    if (!selected || !filePath.trim() || !commitMessage.trim()) return;
    setBusy(true);
    try {
      const result = await api('/.netlify/functions/github-api?action=file', {
        method: 'PUT',
        body: JSON.stringify({ repo: selected, path: filePath, content: fileContent, message: commitMessage, ...(branch ? { branch } : {}), ...(fileSha ? { sha: fileSha } : {}) }),
      });
      setFileSha(result.content?.sha || '');
      toast.success('Commit pushed to ' + (branch || repos.find(r => r.full_name === selected)?.default_branch || 'default branch'));
    } catch (e:any) { toast.error(e.message || 'Commit failed'); }
    finally { setBusy(false); }
  };

  const createBranch = async () => {
    const name = window.prompt('New branch name (example: feature/my-change)');
    if (!name || !selected) return;
    setBusy(true);
    try {
      await api('/.netlify/functions/github-api?action=branch', { method: 'POST', body: JSON.stringify({ repo: selected, branch: name, base: repos.find(r => r.full_name === selected)?.default_branch || 'main' }) });
      setBranch(name);
      setFileSha('');
      toast.success('Branch created: ' + name);
    } catch (e:any) { toast.error(e.message || 'Branch creation failed'); }
    finally { setBusy(false); }
  };

  return <div className="h-full overflow-y-auto bg-background text-foreground">
    <div className="mx-auto max-w-4xl p-5 sm:p-8 space-y-6">
      <button onClick={() => navigate('/')} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16}/> Back to Manus Remix</button>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><div className="rounded-xl border border-border p-3"><Github size={25}/></div><div><h1 className="text-xl font-semibold">GitHub Connector</h1><p className="text-sm text-muted-foreground">Repositories, files, branches and commits</p></div></div>
        <button onClick={refresh} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"><RefreshCw size={15} className={loading?'animate-spin':''}/> Refresh</button>
      </header>
      <section className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm">{status?.connected ? <CheckCircle2 className="text-emerald-500" size={17}/> : <AlertCircle className="text-amber-500" size={17}/>}<span>{status?.connected ? `Connected as @${status.login}` : 'GitHub is not connected'}</span></div>
        {status?.connected ? <button onClick={async()=>{try{await api('/.netlify/functions/github-api?action=disconnect',{method:'POST'});setStatus({connected:false});setRepos([]);toast.success('GitHub disconnected')}catch(e:any){toast.error(e.message)}}} className="text-sm underline text-muted-foreground">Disconnect GitHub</button> : <a href="/.netlify/functions/github-oauth-start" className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm text-background"><Github size={16}/> Connect GitHub</a>}
        <p className="text-xs text-muted-foreground">Authorization is handled by Netlify Functions. Access tokens are never exposed to browser JavaScript.</p>
      </section>
      {status?.connected && <>
        <section className="rounded-xl border border-border p-4 space-y-3">
          <label className="block text-sm font-medium">Repository</label>
          <select value={selected} onChange={e=>{setSelected(e.target.value);setFileSha('');setFileContent('')}} className="w-full rounded-lg border border-border bg-background p-2.5 text-sm">{repos.map(r=><option key={r.id} value={r.full_name}>{r.full_name}{r.private?' · private':''}{r.permissions.push?' · write access':''}</option>)}</select>
          {selected && <a href={repos.find(r=>r.full_name===selected)?.html_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Open on GitHub <ExternalLink size={12}/></a>}
        </section>
        <section className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 font-medium text-sm"><FileCode2 size={16}/> Read or edit a file</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input value={filePath} onChange={e=>setFilePath(e.target.value)} placeholder="src/file.ts" className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm"/>
            <input value={branch} onChange={e=>setBranch(e.target.value)} placeholder={repos.find(r=>r.full_name===selected)?.default_branch || 'main'} className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm"/>
            <button onClick={readFile} disabled={busy || !selected} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">Read file</button>
          </div>
          <textarea value={fileContent} onChange={e=>setFileContent(e.target.value)} placeholder="File contents appear here…" rows={12} className="w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-xs"/>
          <input value={commitMessage} onChange={e=>setCommitMessage(e.target.value)} placeholder="Commit message" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"/>
          <div className="flex flex-wrap gap-2">
            <button onClick={createBranch} disabled={busy || !selected} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"><GitBranch size={15}/> Create branch</button>
            <button onClick={saveFile} disabled={busy || !selected || !filePath.trim() || !commitMessage.trim()} className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">{busy?'Working…':'Commit & push file'}</button>
          </div>
          <p className="text-xs text-muted-foreground">Existing files require the current file SHA when saving. Use a feature branch for changes you want to review before merging.</p>
        </section>
      </>}
    </div>
  </div>;
}
