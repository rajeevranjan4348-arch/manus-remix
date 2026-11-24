import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, BookOpen, CheckCircle2, ChevronRight, FileText, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';

type LegalTab = 'privacy' | 'terms';

const privacySections = [
  { id: 'information', title: '1. Information we handle', body: [
    'Account information such as your name, email address, and authentication identifiers when you sign in.',
    'Content you choose to submit, including prompts, conversations, files, generated outputs, and project information.',
    'Technical and diagnostic information such as device/browser details, app version, approximate usage events, and error reports where enabled.',
    'Information you choose to provide through optional features, such as camera, microphone, location, or connected services. These features should only access data after you grant the relevant permission or connect the service.'
  ]},
  { id: 'use', title: '2. How information is used', body: [
    'To provide chat, agent tasks, research, code and website-building features, save workspace state, and sync supported data across devices.',
    'To authenticate users, protect accounts, prevent abuse, troubleshoot failures, maintain reliability, and improve the service.',
    'To process requests through AI models and other providers required by the feature you choose. The relevant prompt, file, or context may be sent to that provider to produce a response.',
    'To connect to third-party services only when you choose to connect or use an integration.'
  ]},
  { id: 'storage', title: '3. Storage and service providers', body: [
    'The application uses Firebase Authentication and Cloud Firestore for supported account and workspace functions. Some workspace data may also be stored locally in your browser or device, including through IndexedDB.',
    'AI requests, web search, maps, hosting, analytics, and connected integrations may involve third-party providers depending on which features are configured and used.',
    'Each provider processes information under its own terms and privacy documentation. Review those terms before connecting an account or submitting sensitive information.',
    'The exact storage location, retention period, and processing path can vary by feature, account state, configuration, and provider.'
  ]},
  { id: 'sharing', title: '4. When information is shared', body: [
    'We do not describe user content as public by default. Workspace access is intended to follow the account and authorization controls implemented by the application.',
    'Information may be processed by service providers that host, secure, or operate features you request.',
    'Information may be disclosed where required by applicable law, to address security incidents, or to protect users and the service.',
    'If you intentionally share a generated artifact, connect an external service, or publish content, that action may make information available to the recipients or service you select.'
  ]},
  { id: 'controls', title: '5. Your choices and controls', body: [
    'You can review and manage some workspace information using the in-app Settings, Data & Privacy controls, including export, restore, and clearing supported session history.',
    'You can revoke browser/device permissions through your operating system or browser settings, and disconnect third-party integrations where those controls are available.',
    'You may request access, correction, or deletion of personal information, subject to applicable law and technical or legal retention requirements. Use the support/contact route provided inside the application.',
    'Clearing local history may not automatically delete copies held by cloud services or third-party providers. Check the relevant account/provider controls as well.'
  ]},
  { id: 'security', title: '6. Security and retention', body: [
    'We use application-level access controls and security measures intended to protect information. No internet transmission or storage system can be guaranteed to be completely secure.',
    'Information is retained for as long as needed to provide the relevant feature, maintain security and operational records, meet legal obligations, or resolve disputes. Retention can differ between local storage, cloud data, backups, and third-party services.',
    'Do not submit passwords, payment card details, government identity numbers, confidential business secrets, or other highly sensitive information unless a feature explicitly requires it and you understand the applicable provider terms.'
  ]},
  { id: 'children', title: '7. Children and young users', body: [
    'The service is not designed to collect personal information from children in violation of applicable age requirements. If you are not old enough to use the service independently under the laws that apply to you, use it only with the involvement and permission of a parent or legal guardian.',
    'If you believe a child has provided personal information improperly, contact us through the in-app support route so the issue can be reviewed.'
  ]},
  { id: 'changes', title: '8. Changes and contact', body: [
    'We may update this notice as features, providers, or legal requirements change. The latest version will be published on this page with an updated effective date.',
    'For privacy questions or requests, use the support/contact option available within Manus Remix. Do not send credentials or secret keys in a support message.'
  ]}
];

const termsSections = [
  { id: 'acceptance', title: '1. Agreement to these terms', body: [
    'These Terms govern your access to and use of Manus Remix, including its chat, AI agent, research, coding, file, workspace, and integration features.',
    'By accessing or using the service, you agree to these Terms. If you do not agree, do not use the service.'
  ]},
  { id: 'eligibility', title: '2. Eligibility and accounts', body: [
    'You must be legally permitted to use the service where you live. If local law requires parent or guardian involvement, you must obtain it before using the service.',
    'You are responsible for keeping your sign-in methods secure and for activity performed through your account. Notify the service operator through the in-app support route if you suspect unauthorized access.',
    'Provide accurate account information and do not impersonate another person or misrepresent your affiliation.'
  ]},
  { id: 'acceptable', title: '3. Acceptable use', body: [
    'Do not use the service to violate laws, infringe rights, distribute malware, attempt unauthorized access, interfere with systems, or bypass security and usage limits.',
    'Do not use generated content or automation to harass, deceive, exploit, or harm others, or to make high-impact decisions without appropriate human review.',
    'Respect third-party websites, APIs, licenses, rate limits, and terms when using research, browsing, connectors, code execution, or other integrations.',
    'You are responsible for reviewing files, commands, code, and external actions before approving or running them.'
  ]},
  { id: 'ai', title: '4. AI outputs and human review', body: [
    'AI-generated responses may be inaccurate, incomplete, outdated, biased, or unsuitable for your situation. Outputs are provided for general informational and productivity purposes and are not a substitute for qualified professional advice.',
    'You must independently verify important facts, citations, code, calculations, and recommendations before relying on them or sharing them.',
    'Do not treat an AI response as a guarantee that code is secure, legal, non-infringing, or fit for production. Test and review all generated work.'
  ]},
  { id: 'content', title: '5. Your content and generated work', body: [
    'You retain rights you already hold in the prompts, files, and other content you submit. You grant the service and its necessary providers permission to process that content only as needed to operate, secure, and deliver the features you request.',
    'You are responsible for ensuring you have the rights and permissions needed to submit content and to use, publish, or distribute generated outputs.',
    'Generated outputs may not be unique, and similar outputs may be produced for other users. Third-party materials, model terms, and open-source licenses may impose additional conditions.'
  ]},
  { id: 'third-party', title: '6. Third-party services', body: [
    'The service may link to or integrate with third-party products, APIs, websites, models, hosting providers, and storage services. Those services are controlled by their respective providers.',
    'Your use of a third-party service may be subject to separate terms, privacy notices, charges, availability limits, and data handling practices. We are not responsible for services we do not control.'
  ]},
  { id: 'availability', title: '7. Availability and changes', body: [
    'Features may change, be suspended, or become unavailable as providers, infrastructure, security requirements, or product priorities change.',
    'We may apply reasonable usage limits to protect reliability, prevent abuse, and manage provider costs. We do not guarantee uninterrupted or error-free availability.'
  ]},
  { id: 'disclaimers', title: '8. Disclaimers and liability', body: [
    'To the extent permitted by applicable law, the service is provided on an “as is” and “as available” basis without warranties of any kind.',
    'To the extent permitted by law, the service operator will not be liable for indirect, incidental, special, consequential, or punitive loss, or loss of data, profits, goodwill, or business opportunity arising from use of the service.',
    'Nothing in these Terms excludes or limits liability that cannot legally be excluded or limited under applicable law. Your mandatory consumer rights remain unaffected.'
  ]},
  { id: 'termination', title: '9. Suspension and termination', body: [
    'Access may be restricted or suspended where reasonably necessary to protect users, the service, third parties, or to comply with law or these Terms.',
    'You may stop using the service at any time. Some information may remain in backups, security records, or third-party systems for limited periods as described in the Privacy Policy or required by law.'
  ]},
  { id: 'updates', title: '10. Updates and contact', body: [
    'We may revise these Terms from time to time. Continued use after updated Terms are published means you accept the revised Terms to the extent permitted by law.',
    'Questions about these Terms should be sent through the support/contact route provided inside Manus Remix.'
  ]}
];

export function LegalPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab: LegalTab = location.pathname.endsWith('/terms') ? 'terms' : 'privacy';
  const [query, setQuery] = useState('');
  const sections = activeTab === 'privacy' ? privacySections : termsSections;
  const filteredSections = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sections;
    return sections.filter((section) => (section.title + ' ' + section.body.join(' ')).toLowerCase().includes(normalized));
  }, [query, sections]);

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-8 sm:py-8">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight hover:opacity-70">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-foreground text-background"><Sparkles size={16} /></span>
            Deku AI Workspace
          </Link>
          <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:bg-muted/60">
            <ArrowLeft size={14} /> Back
          </button>
        </div>

        <section className="py-10 sm:py-14">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <ShieldCheck size={13} /> Trust, privacy & responsible use
          </div>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">Clear rules. Respect for your data.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
            Read how Manus Remix handles information and the terms that apply when you use the workspace.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>Effective date: 24 November 2026</span><span aria-hidden="true">·</span><span>Last updated: 24 November 2026</span>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">Draft for review</span>
          </div>
        </section>

        <div className="sticky top-0 z-10 -mx-4 border-y border-border/60 bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-1 rounded-xl bg-muted/60 p-1">
              <button onClick={() => navigate('/privacy')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${activeTab === 'privacy' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><LockKeyhole size={14} /> Privacy Policy</button>
              <button onClick={() => navigate('/terms')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${activeTab === 'terms' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><FileText size={14} /> Terms & Conditions</button>
            </div>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this document..." aria-label="Search legal document" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring sm:max-w-xs" />
          </div>
        </div>

        <div className="grid gap-8 py-8 lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl border border-border/70 bg-card p-4">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">On this page</p>
              <nav className="space-y-1">
                {sections.map((section) => <a key={section.id} href={`#${section.id}`} className="flex items-center justify-between rounded-lg px-2 py-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground">{section.title.replace(/^\d+\. /, '')}<ChevronRight size={12} /></a>)}
              </nav>
              <div className="mt-4 border-t border-border/60 pt-3 text-[11px] leading-5 text-muted-foreground">This document is a product-policy draft. Review it against the final deployment and applicable law before publication.</div>
            </div>
          </aside>

          <main className="min-w-0 space-y-4">
            <div className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted"><BookOpen size={17} /></div>
                <div><h2 className="text-sm font-semibold">{activeTab === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions'}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{activeTab === 'privacy' ? 'A practical overview of information, storage, providers, and your available controls.' : 'The basic rules for using AI features, integrations, generated work, and the workspace.'}</p></div>
              </div>
            </div>

            {filteredSections.length === 0 && <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No sections match “{query}”. Try another search.</div>}
            {filteredSections.map((section) => (
              <section id={section.id} key={section.id} className="scroll-mt-28 rounded-2xl border border-border/70 bg-card p-5 sm:p-7">
                <h3 className="text-base font-semibold tracking-tight">{section.title}</h3>
                <div className="mt-4 space-y-3">
                  {section.body.map((paragraph, index) => <p key={index} className="text-sm leading-7 text-muted-foreground">{paragraph}</p>)}
                </div>
              </section>
            ))}

            <div className="rounded-2xl border border-border/70 bg-muted/30 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                <div><h3 className="text-sm font-semibold">Need help with a privacy request?</h3><p className="mt-1 text-xs leading-6 text-muted-foreground">Open the in-app support/contact option and describe your request. Never include passwords, API keys, or other credentials.</p></div>
              </div>
            </div>
          </main>
        </div>

        <footer className="flex flex-col gap-3 border-t border-border/60 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Deku AI Workspace. All rights reserved.</span>
          <div className="flex gap-4"><Link className="hover:text-foreground" to="/privacy">Privacy Policy</Link><Link className="hover:text-foreground" to="/terms">Terms & Conditions</Link><Link className="inline-flex items-center gap-1 hover:text-foreground" to="/">Return to workspace <ArrowUpRight size={12} /></Link></div>
        </footer>
      </div>
    </div>
  );
}
