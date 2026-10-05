const releaseStatus = document.querySelector('#release-status');
const releases = 'https://github.com/help-me-prism/prism-releases/releases';
const channels = 'https://raw.githubusercontent.com/help-me-prism/prism-releases/main/channels/';
const counterApi = 'https://prism-feedback.help-me-prism.workers.dev/downloads';
const countLabel = document.querySelector('#download-count');
// Local-only display sample; never changes stored counts or runs on the published site.
const countPreview = location.origin === 'http://127.0.0.1:4173' && new URLSearchParams(location.search).get('preview-count') === '51';
let latestCount = 0;

function showDownloadCount(total) {
  if (!countLabel || !Number.isSafeInteger(total) || total < 0) return;
  latestCount = countPreview ? 51 : Math.max(latestCount, total);
  countLabel.hidden = latestCount <= 50;
  countLabel.textContent = latestCount > 50 ? `누적 다운로드 ${latestCount.toLocaleString('ko-KR')}회${countPreview ? ' · 표시 예시' : ''}` : '';
  countLabel.title = '기존 다운로드와 이 사이트의 설치 ZIP 버튼 클릭을 합산합니다. 설치 완료나 고유 사용자 수와는 다릅니다.';
}

async function refreshDownloadCount() {
  try {
    const response = await fetch(`${counterApi}/summary`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (response.ok) showDownloadCount((await response.json()).total);
  } catch { /* Counter availability never blocks the download. */ }
  if (countPreview) showDownloadCount(51);
}

async function recordDownloadClick(event) {
  // Preview clicks and fallback links must not inflate the production counter.
  if (location.origin !== 'https://help-me-prism.github.io') return;
  if (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0) return;
  const link = event.currentTarget;
  if (!link.dataset.zipReady || link.getAttribute('aria-disabled') === 'true') return;
  const [platform, arch] = link.dataset.download.split('-');
  try {
    const response = await fetch(`${counterApi}/click`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ id: crypto.randomUUID(), platform, arch }),
      keepalive: true, credentials: 'omit',
    });
    if (response.ok) showDownloadCount((await response.json()).total);
  } catch { /* The real ZIP link still works when counting fails. */ }
}

for (const link of document.querySelectorAll('[data-download]')) {
  link.addEventListener('click', recordDownloadClick);
  link.addEventListener('auxclick', recordDownloadClick);
}
if (countLabel) {
  if (countPreview) showDownloadCount(51);
  void refreshDownloadCount();
}

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(String(version));
  return match && [+match[1], +match[2], +match[3], match[4] === undefined ? Infinity : +match[4]];
}

function newer(a, b) {
  const left = versionParts(a.version), right = versionParts(b.version);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}

async function loadChannel(channel) {
  const response = await fetch(`${channels}${channel}.json`, {
    cache: 'no-cache', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return undefined;
  const manifest = await response.json();
  return manifest && versionParts(manifest.version) && Array.isArray(manifest.assets) ? manifest : undefined;
}

// Match both platform and CPU. Each installer has a companion ZIP containing its installation guide.
function downloadUrl(manifest, key) {
  const [platform, arch] = key.split('-');
  const asset = manifest.assets.find(item => item?.platform === platform && item.arch === arch);
  const name = platform === 'win32' ? 'Windows' : 'macOS';
  const stem = `${releases}/download/v${manifest.version}/Prism-${manifest.version}-${name}-${arch}`;
  return asset?.url === `${stem}.${platform === 'win32' ? 'exe' : 'dmg'}` ? `${stem}-Setup-Guide.zip` : undefined;
}

function showChanges(manifest) {
  const section = /^## 변경사항\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(String(manifest.notes ?? ''));
  const items = (section?.[1] ?? '').split('\n').map(line => line.trim()).filter(line => line.startsWith('- ')).slice(0, 3);
  const list = document.querySelector('#release-changes');
  const status = document.querySelector('#changes-status');
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item.slice(2).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '');
    list.append(li);
  }
  list.hidden = !items.length;
  status.hidden = !!items.length;
  status.textContent = items.length ? '' : '등록된 변경 내용이 없습니다.';
}

function showReleaseDate(manifest) {
  const label = document.querySelector('#release-date');
  const date = /최근 업데이트:\s*(\d{4}-\d{2}-\d{2})/.exec(String(manifest.notes ?? ''))?.[1];
  if (!label || !date || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return;
  label.textContent = `최근 업데이트 · ${date.replaceAll('-', '.')}`;
  label.hidden = false;
}

async function loadRelease() {
  try {
    const found = await Promise.all(['beta', 'stable'].map(channel => loadChannel(channel).catch(() => undefined)));
    const manifest = found.filter(Boolean).reduce((best, item) => !best || newer(item, best) ? item : best, undefined);
    if (!manifest) throw new Error('No release channel');
    let available = 0;
    for (const link of document.querySelectorAll('[data-download]')) {
      const url = downloadUrl(manifest, link.dataset.download);
      if (!url) { link.textContent = '이번 버전 미제공'; continue; }
      link.href = url;
      link.dataset.zipReady = 'true';
      link.removeAttribute('aria-disabled');
      link.textContent = '설치 ZIP 다운로드';
      available++;
    }
    if (!available) throw new Error('No downloadable assets');
    showChanges(manifest);
    showReleaseDate(manifest);
  } catch {
    releaseStatus.hidden = false;
    releaseStatus.textContent = '최신 설치 파일 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.';
    for (const link of document.querySelectorAll('[data-download]')) {
      link.removeAttribute('href');
      delete link.dataset.zipReady;
      link.setAttribute('aria-disabled', 'true');
      link.textContent = '잠시 후 다시 확인';
    }
    document.querySelector('#changes-status').textContent = '변경 내용을 불러오지 못했습니다.';
  }
}
if (releaseStatus) void loadRelease();
const heroSlides = [...document.querySelectorAll('[data-hero-slide]')];
if (heroSlides.length) {
  const indicators = [...document.querySelectorAll('[data-hero-indicator]')];
  const position = document.querySelector('.hero-progress');
  let current = 0, timer;
  function schedule() {
    clearTimeout(timer);
    if (!document.hidden) timer = setTimeout(() => select(current + 1), 5500);
  }
  function select(index) {
    current = (index + heroSlides.length) % heroSlides.length;
    heroSlides.forEach((slide, i) => slide.classList.toggle('is-active', i === current));
    indicators.forEach((indicator, i) => indicator.classList.toggle('is-active', i === current));
    position.setAttribute('aria-label', `${heroSlides.length}개 화면 중 ${current + 1}번째`);
    schedule();
  }
  document.querySelector('[data-hero-prev]').addEventListener('click', () => select(current - 1));
  document.querySelector('[data-hero-next]').addEventListener('click', () => select(current + 1));
  document.addEventListener('visibilitychange', schedule);
  select(0);
}
const guideSections=[...document.querySelectorAll('.guide-section')];
const guideLinks=new Map([...document.querySelectorAll('.toc a')].map(link=>[link.hash.slice(1),link]));
let activeGuideId;
let guideFrame;
function updateGuidePosition(){
 guideFrame=undefined;
 const visible=guideSections.filter(section=>!section.hidden);
 let active=visible[0];
 // Keep the current section selected until the next heading reaches the reading line.
 const readingLine=Math.min(120,window.innerHeight*.2);
 for(const section of visible){if(section.getBoundingClientRect().top<=readingLine)active=section;else break}
 if(visible.length&&window.scrollY>0&&window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-2)active=visible.at(-1);
 const id=active?.id;
 if(id===activeGuideId)return;
 activeGuideId=id;
 for(const [sectionId,link] of guideLinks){
  if(sectionId===id)link.setAttribute('aria-current','location');
  else link.removeAttribute('aria-current');
 }
}
function scheduleGuidePosition(){if(guideFrame===undefined)guideFrame=requestAnimationFrame(updateGuidePosition)}
if(guideSections.length){
 window.addEventListener('scroll',scheduleGuidePosition,{passive:true});
 window.addEventListener('resize',scheduleGuidePosition);
 window.addEventListener('hashchange',scheduleGuidePosition);
 window.addEventListener('load',scheduleGuidePosition);
 document.fonts?.ready.then(scheduleGuidePosition);
 scheduleGuidePosition();
}
const search=document.querySelector('#guide-search');
search?.addEventListener('input',()=>{
 const query=search.value.trim().toLocaleLowerCase();let count=0;
 for(const section of document.querySelectorAll('.guide-section')){const show=section.textContent.toLocaleLowerCase().includes(query);section.hidden=!show;if(show)count++;document.querySelector(`.toc a[href="#${section.id}"]`).hidden=!show}
 document.querySelector('#search-status').textContent=query?`${count}개 항목`:'';document.querySelector('#no-results').hidden=count>0;
 scheduleGuidePosition();
});
