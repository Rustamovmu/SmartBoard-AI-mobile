import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { safeLocalError, type Capture, type Lecture, type Page } from '@smartbord/local-library';
import { nativeLibrary, takeNativePhoto } from './native-vault';
import './styles.css';

function Mark({ camera = false }: { camera?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    {camera ? <><path d="M8 5l1-2h6l1 2h4v15H4V5z"/><circle cx="12" cy="12" r="4"/></> : <><path d="M4 4h16v13H4zM8 21l4-4 4 4M8 8h8M8 12h5"/></>}
  </svg>;
}
const emptyPage: Page<Capture> = { items: [], page: 1, pageSize: 30, total: 0 };
function timestamp(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }

export default function App() {
  const native = Capacitor.isNativePlatform();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'unavailable'>(native ? 'loading' : 'unavailable');
  const [lectures, setLectures] = useState<Page<Lecture>>({ ...emptyPage, items: [] });
  const [selected, setSelected] = useState<Lecture | null>(null);
  const [captures, setCaptures] = useState<Page<Capture>>(emptyPage);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const [opened, setOpened] = useState<{ capture: Capture; uri: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const busyGate = useRef(false);

  async function initialize() {
    if (!native) return;
    setPhase('loading'); setError('');
    try {
      const library = nativeLibrary();
      await library.initialize();
      const recovered = await library.recoverPending();
      setPending(recovered.remaining);
      if (recovered.recovered) setNotice(`${recovered.recovered} interrupted save${recovered.recovered === 1 ? '' : 's'} recovered on this phone.`);
      setLectures(await library.listLectures());
      setPhase('ready');
    } catch (value) { setError(safeLocalError(value).message); setPhase('error'); }
  }
  useEffect(() => { void initialize(); }, []);
  useEffect(() => { if (selected) heading.current?.focus(); }, [selected]);

  async function action(label: string, work: () => Promise<void>) {
    if (busyGate.current) return;
    busyGate.current = true;
    setBusy(label); setError(''); setNotice('');
    try { await work(); }
    catch (value) {
      setError(safeLocalError(value).message);
      if (native && phase === 'ready') {
        try { setPending(await nativeLibrary().pendingCount()); } catch { /* keep the original useful error */ }
      }
    }
    finally { busyGate.current = false; setBusy(''); }
  }
  async function selectLecture(value: Lecture) {
    await action('Opening lecture…', async () => {
      const page = await nativeLibrary().listCaptures(value.id);
      setCaptures(page); setOpened(null); setSelected(value);
    });
  }
  function createLecture(event: FormEvent) {
    event.preventDefault();
    void action('Creating lecture…', async () => {
      const value = await nativeLibrary().createLecture(title);
      setTitle(''); setLectures(await nativeLibrary().listLectures());
      setCaptures(emptyPage); setSelected(value);
      setNotice('Lecture created in app storage on this phone.');
    });
  }
  async function capture() {
    if (!selected) return;
    await action('Taking and saving photo…', async () => {
      const library = nativeLibrary();
      const request = library.newRequestId();
      const source = await takeNativePhoto();
      await library.savePhoto(selected.id, source, request);
      setCaptures(await library.listCaptures(selected.id));
      setNotice('Saved on this phone. Original and local catalog verified.');
    });
  }
  async function recover() {
    await action('Checking interrupted saves…', async () => {
      const result = await nativeLibrary().recoverPending();
      setPending(result.remaining);
      if (selected) setCaptures(await nativeLibrary().listCaptures(selected.id));
      setNotice(result.recovered ? `${result.recovered} saved original${result.recovered === 1 ? '' : 's'} recovered.` : 'No additional save could be recovered. Incomplete files have not been deleted.');
    });
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="wordmark" href="#" onClick={event => { event.preventDefault(); if (!busy) { setSelected(null); setOpened(null); } }} aria-label="SmartBord local library"><Mark/><span>SmartBord<span className="wordmark-dot">.</span></span></a>
      <span className="mode-badge"><span/>Local mode</span>
    </header>
    <main>
      <section className="hero">
        <div className="eyebrow">YOUR PERSONAL BOARD LIBRARY</div>
        <h1>Keep the board.<br/><em>Keep it yours.</em></h1>
        <p>Manual photos and lecture names stay in the installed app’s storage on your phone.</p>
        <div className="privacy-line"><span aria-hidden="true">↳</span> No backend connection is used by this build.</div>
      </section>

      {phase === 'unavailable' && <aside className="platform-note" aria-labelledby="native-required"><div className="note-icon"><Mark/></div><div><h2 id="native-required">Mobile build required</h2><p>This browser preview cannot open a phone’s camera or native SQLite library. Install the Android or iPhone build to save and reopen actual captures.</p></div></aside>}
      {phase === 'loading' && <p role="status" className="feedback">Preparing the local library and checking interrupted saves…</p>}
      {error && <div role="alert" className="feedback error">{error}{phase === 'error' && <button className="text-button" onClick={() => void initialize()}>Retry local storage</button>}</div>}
      <div className="live-feedback" role="status" aria-live="polite">{busy || notice}</div>
      {pending > 0 && <aside className="pending-note"><strong>{pending} incomplete save{pending === 1 ? '' : 's'}</strong><p>Some original files may still be recoverable. No incomplete save is shown as accepted.</p><button disabled={!!busy} onClick={() => void recover()}>Retry recovery</button></aside>}

      {!selected ? <section className="library" aria-labelledby="library-heading">
        <div className="section-heading"><div><span className="eyebrow">ON THIS DEVICE</span><h2 id="library-heading">Your lectures</h2></div>{phase === 'ready' && <span className="count-label">{lectures.total} lecture{lectures.total === 1 ? '' : 's'}</span>}</div>
        <form className="create-form" onSubmit={createLecture} aria-describedby={native ? undefined : 'native-required'}>
          <label htmlFor="lecture-title">New lecture name</label>
          <div><input id="lecture-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required placeholder="Name a lecture" disabled={phase !== 'ready' || !!busy}/><button type="submit" disabled={phase !== 'ready' || !!busy || !title.trim()}>Create lecture <span aria-hidden="true">↗</span></button></div>
        </form>
        {phase === 'ready' && lectures.items.length > 0 ? <ul className="lecture-list">{lectures.items.map(value => <li key={value.id}><button onClick={() => void selectLecture(value)} disabled={!!busy}><span className="lecture-icon"><Mark/></span><span><strong>{value.title}</strong><small>Created {timestamp(value.createdAt)}</small></span><span aria-hidden="true">→</span></button></li>)}</ul> : <div className="empty-state"><div className="board-illustration" aria-hidden="true"><i/><i/><i/><span/></div><h3>{phase === 'unavailable' ? 'A private library, on your phone' : 'Make room for your next idea'}</h3><p>{phase === 'unavailable' ? 'No device library is open in this preview. No sample lectures or captures are displayed.' : 'Create a lecture, then take your first photo. Accepted originals will be listed here.'}</p></div>}
        {lectures.page * lectures.pageSize < lectures.total && <button disabled={!!busy} onClick={() => void action('Loading lectures…', async () => { const next = await nativeLibrary().listLectures(lectures.page + 1); setLectures({ ...next, items: [...lectures.items, ...next.items] }); })}>Load more lectures</button>}
      </section> : <section className="library" aria-labelledby="lecture-heading">
        <button className="text-button back-button" disabled={!!busy} onClick={() => { setSelected(null); setOpened(null); setNotice(''); }}>← All lectures</button>
        <div className="section-heading"><div><span className="eyebrow">APP STORAGE ON THIS PHONE</span><h2 id="lecture-heading" ref={heading} tabIndex={-1}>{selected.title}</h2></div><span className="count-label">{captures.total} capture{captures.total === 1 ? '' : 's'}</span></div>
        <button className="capture-button" disabled={!!busy} onClick={() => void capture()}><Mark camera/>Take a manual photo</button>
        <p className="capture-hint">Rear camera · saved in app · no gallery copy or AI analysis</p>
        {captures.items.length === 0 ? <div className="empty-state compact"><Mark camera/><h3>Your first original starts here</h3><p>Only a photo that finishes its local file and catalog save will appear below.</p></div> : <ul className="capture-list">{captures.items.map(value => <li key={value.id}><button disabled={!!busy} onClick={() => void action('Checking saved original…', async () => { setOpened(await nativeLibrary().openCapture(value.id)); })}><span className="capture-thumb"><Mark camera/></span><span><strong>Manual capture</strong><small>{timestamp(value.createdAt)} · {(value.bytes / 1_000_000).toFixed(1)} MB</small></span><span>Open original ↗</span></button></li>)}</ul>}
        {captures.page * captures.pageSize < captures.total && <button disabled={!!busy} onClick={() => void action('Loading captures…', async () => { const next = await nativeLibrary().listCaptures(selected.id, captures.page + 1); setCaptures({ ...next, items: [...captures.items, ...next.items] }); })}>Load more captures</button>}
        {opened && <figure className="original-view"><figcaption><strong>Verified local original</strong><button className="text-button" onClick={() => setOpened(null)}>Close image</button></figcaption><img src={opened.uri} alt={`Original manual capture from ${selected.title}`} onError={() => { setOpened(null); setError('The saved file could not be displayed. It has not been replaced or downloaded.'); }}/><p>SHA-256 checked against the on-device catalog before opening.</p></figure>}
      </section>}

      <footer className="storage-footer"><div className="storage-symbol" aria-hidden="true">⌁</div><div><strong>In app, on this phone</strong><p>App-owned files can be removed when the app is uninstalled. Gallery and bundle export are not implemented in this build.</p></div></footer>
    </main>
  </div>;
}
