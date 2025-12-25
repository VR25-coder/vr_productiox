(function() {
  const API_BASE = '';
  let authToken = localStorage.getItem('admin_token') || null;
  let livePortfolio = {};

  function setAuthToken(token) {
    authToken = token;
    if (token) localStorage.setItem('admin_token', token);
    else localStorage.removeItem('admin_token');
  }

  function api(path, options = {}) {
    const headers = options.headers || {};
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    if (!options.body && options.json) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.json);
    }
    return fetch(API_BASE + path, { ...options, headers })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json().catch(() => ({}));
      });
  }

  // Helper: upload a file (image/video) to the server and return { success, url, fileName }
  function uploadFileToServer(file, folder) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result;
        api('/api/upload', {
          method: 'POST',
          json: {
            fileName: file.name,
            content,
            folder: folder || ''
          }
        })
          .then(resolve)
          .catch(reject);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Login handling
  const loginEl = document.getElementById('admin-login');
  const shellEl = document.getElementById('admin-shell');
  const loginBtn = document.getElementById('login-btn');
  const pwdInput = document.getElementById('admin-password');
  const loginError = document.getElementById('login-error');

  function showShell() {
    loginEl.style.display = 'none';
    shellEl.style.display = 'block';
    initTabs();
    initStatusBar();
    initTasks();
    loadPortfolio();
    loadMessages();
    loadInvoices();
    // security tab is lazily initialized on click
  }

  loginBtn.addEventListener('click', () => {
    const password = pwdInput.value.trim();
    loginError.style.display = 'none';
    api('/api/login', { method: 'POST', json: { password } })
      .then(data => {
        if (!data.token) throw new Error('no-token');
        setAuthToken(data.token);
        showShell();
      })
      .catch(() => {
        loginError.style.display = 'block';
      });
  });

  if (authToken) {
    api('/api/messages')
      .then(() => showShell())
      .catch(() => setAuthToken(null));
  }

  // Tabs
  function initTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    const panels = {
      portfolio: document.getElementById('tab-portfolio'),
      messages: document.getElementById('tab-messages'),
      reviews: document.getElementById('tab-reviews'),
      billing: document.getElementById('tab-billing'),
      tasks: document.getElementById('tab-tasks'),
      ai: document.getElementById('tab-ai'),
      learning: document.getElementById('tab-learning'),
      security: document.getElementById('tab-security')
    };
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        Object.values(panels).forEach(p => p && p.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.getAttribute('data-tab');
        const panel = panels[tab];
        if (panel) panel.classList.add('active');
        if (tab === 'messages') loadMessages();
        if (tab === 'reviews') initReviewsTab();
        if (tab === 'billing') loadInvoices();
        if (tab === 'tasks') renderTasks();
        if (tab === 'security') initSecurityTab();
      });
    });
  }

  // Status bar (clock + battery)
  function initStatusBar() {
    const clockEl = document.getElementById('status-clock');
    const batteryEl = document.getElementById('status-battery');
    const clockPill = document.getElementById('status-clock-pill');
    const batteryPill = document.getElementById('status-battery-pill');

    // Clock: update every second (local time)
    if (clockEl) {
      const fmt = new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      const tick = () => {
        clockEl.textContent = fmt.format(new Date()).replace(',', '')
          .replace(' ', ' • ');
      };

      tick();
      setInterval(tick, 1000);
    }

    // Battery: only accurate if the browser supports Battery Status API.
    if (batteryEl && batteryPill) {
      const setBattery = ({ pct, charging, supported }) => {
        if (!supported) {
          // If it's not supported, hide it ("accurate" requirement).
          batteryPill.style.display = 'none';
          return;
        }

        batteryPill.style.display = 'inline-flex';
        const pctText = typeof pct === 'number' && !Number.isNaN(pct) ? `${pct}%` : '--%';
        const chargeText = charging ? '⚡' : '';
        batteryEl.textContent = `${pctText} ${chargeText}`.trim();

        const low = typeof pct === 'number' && pct < 20 && !charging;
        if (low) {
          batteryPill.style.borderColor = '#ef4444';
          batteryPill.style.color = '#fecaca';
          batteryPill.style.background = 'rgba(239, 68, 68, 0.10)';
          batteryPill.title = 'Low battery (< 20%)';
        } else {
          batteryPill.style.borderColor = '#333';
          batteryPill.style.color = '#cbd5e1';
          batteryPill.style.background = '#000';
          batteryPill.title = '';
        }
      };

      if (navigator.getBattery) {
        navigator.getBattery()
          .then(battery => {
            const update = () => {
              const pct = Math.round((battery.level || 0) * 100);
              setBattery({ pct, charging: !!battery.charging, supported: true });
            };
            update();
            battery.addEventListener('levelchange', update);
            battery.addEventListener('chargingchange', update);
          })
          .catch(() => setBattery({ pct: null, charging: false, supported: false }));
      } else {
        setBattery({ pct: null, charging: false, supported: false });
      }
    }

    // Make sure pills are visible even if fonts/styles change
    if (clockPill) clockPill.style.whiteSpace = 'nowrap';
    if (batteryPill) batteryPill.style.whiteSpace = 'nowrap';
  }

  // Tasks (localStorage)
  const TASKS_KEY = 'vr_admin_tasks';
  let tasksState = [];
  let tasksHandlersBound = false;

  function loadTasksFromStorage() {
    try {
      const raw = localStorage.getItem(TASKS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      tasksState = Array.isArray(parsed) ? parsed : [];
    } catch {
      tasksState = [];
    }
  }

  function saveTasksToStorage() {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasksState));
    } catch (e) {
      console.warn('Failed to save tasks', e);
    }
  }

  function initTasks() {
    loadTasksFromStorage();

    const addTask = () => {
      const input = document.getElementById('task-input');
      loadTasksFromStorage();
      const text = (input && input.value || '').trim();
      if (!text) return;

      const id = 'task_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      tasksState.unshift({ id, text, done: false, createdAt: new Date().toISOString() });
      saveTasksToStorage();
      if (input) input.value = '';
      renderTasks();
    };

    // Bind once, but do NOT capture DOM nodes (tab may be inactive when binding)
    if (!tasksHandlersBound) {
      tasksHandlersBound = true;

      document.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('#task-add') : null;
        if (!btn) return;
        addTask();
      });

      document.addEventListener('keydown', (e) => {
        const input = e.target;
        if (!input || input.id !== 'task-input') return;
        if (e.key === 'Enter') {
          e.preventDefault();
          addTask();
        }
      });
    }

    renderTasks();
  }

  function renderTasks() {
    loadTasksFromStorage();
    const list = document.getElementById('tasks-list');
    if (!list) return;
    list.innerHTML = '';

    if (!tasksState.length) {
      const empty = document.createElement('p');
      empty.style.color = '#9ca3af';
      empty.style.fontSize = '0.85rem';
      empty.textContent = 'No tasks yet.';
      list.appendChild(empty);
      return;
    }

    tasksState.forEach((t, idx) => {
      const item = document.createElement('div');
      item.className = 'task-item';

      const left = document.createElement('div');
      left.className = 'task-left';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!t.done;
      cb.style.marginTop = '0.2rem';

      const textWrap = document.createElement('div');
      const text = document.createElement('div');
      text.className = 'task-text';
      text.textContent = t.text || '';
      text.style.textDecoration = t.done ? 'line-through' : 'none';
      text.style.color = t.done ? '#94a3b8' : '#e5e7eb';

      const meta = document.createElement('div');
      meta.style.fontSize = '0.72rem';
      meta.style.color = '#64748b';
      meta.style.marginTop = '0.2rem';
      meta.textContent = t.createdAt ? `Created: ${t.createdAt}` : '';

      textWrap.appendChild(text);
      if (t.createdAt) textWrap.appendChild(meta);

      left.appendChild(cb);
      left.appendChild(textWrap);

      const actions = document.createElement('div');
      actions.className = 'list-item-actions';

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.style.padding = '0.3rem 0.6rem';
      del.style.borderRadius = '6px';
      del.style.border = 'none';
      del.style.background = '#ef4444';
      del.style.color = '#fff';
      del.style.fontSize = '0.75rem';
      del.style.cursor = 'pointer';

      cb.addEventListener('change', () => {
        tasksState[idx].done = cb.checked;
        saveTasksToStorage();
        renderTasks();
      });

      del.addEventListener('click', () => {
        tasksState.splice(idx, 1);
        saveTasksToStorage();
        renderTasks();
      });

      actions.appendChild(del);

      item.appendChild(left);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  // Portfolio editing
  const portfolioFormEl = document.getElementById('portfolio-form');
  const portfolioPreviewEl = document.getElementById('portfolio-preview');

  function buildPortfolioForm(data) {
    livePortfolio = data || {};
    portfolioFormEl.innerHTML = '';

    function fieldRow(key, label, value, multiline) {
      const wrap = document.createElement('div');
      wrap.className = 'field-group';
      const id = 'pf_' + key;
      wrap.innerHTML = `
        <label for="${id}">${label}</label>
        ${multiline
          ? `<textarea id="${id}" data-key="${key}">${value || ''}</textarea>`
          : `<input id="${id}" data-key="${key}" value="${value || ''}">`
        }
      `;
      portfolioFormEl.appendChild(wrap);
    }

    function addUploadControl(targetKey, label, accept, folder) {
      const baseInput = portfolioFormEl.querySelector(`[data-key="${targetKey}"]`);
      if (!baseInput) return;
      const container = document.createElement('div');
      container.className = 'field-group';
      const uploadId = 'pf_upload_' + targetKey.replace(/\./g, '_');
      container.innerHTML = `
        <label for="${uploadId}">${label}</label>
        <input id="${uploadId}" type="file" accept="${accept}">
      `;
      baseInput.parentElement.insertAdjacentElement('afterend', container);
      const fileInput = container.querySelector('input[type="file"]');
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        fileInput.disabled = true;
        uploadFileToServer(file, folder)
          .then(info => {
            if (info && (info.url || info.fileName)) {
              baseInput.value = info.url || info.fileName;
              baseInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
          })
          .catch(() => {
            alert('Failed to upload file.');
          })
          .finally(() => {
            fileInput.value = '';
            fileInput.disabled = false;
          });
      });
    }

    // Navigation
    fieldRow('navigation.brand', 'Brand name', (data.navigation && data.navigation.brand) || 'Vrutant');
    fieldRow('navigation.subtitle', 'Brand subtitle', (data.navigation && data.navigation.subtitle) || 'Video Editor');
    fieldRow('navigationMenuText', 'Navigation menu (label | href per line)',
      (data.navigation && Array.isArray(data.navigation.menu)
        ? data.navigation.menu.map(m => `${m.label || ''} | ${m.href || ''}`).join('\n')
        : ''
      ),
      true
    );

    fieldRow('personal.title', 'Hero title (use \\n for new line)', (data.personal && data.personal.title) || '', true);
    fieldRow('personal.description', 'Hero description', (data.personal && data.personal.description) || '', true);
    fieldRow('personal.availability', 'Availability text', (data.personal && data.personal.availability) || 'Available for Projects');
    fieldRow('hero.image', 'Hero image filename', (data.hero && data.hero.image) || 'Instagram post - 21.jpg.png');
    fieldRow('about.title', 'About title', (data.about && data.about.title) || 'About Me');
    fieldRow('about.intro', 'About intro', (data.about && data.about.intro) || '', true);
    fieldRow('about.description', 'About description', (data.about && data.about.description) || '', true);
    fieldRow('about.mainImage', 'About main image filename', (data.about && data.about.mainImage) || 'v_image2.jpg');
    fieldRow('about.smallImage', 'About secondary image filename', (data.about && data.about.smallImage) || 'v3.jpg.webp');

    // Experience / section headings
    fieldRow('experienceSection.title', 'Experience section title', data.experienceSection && data.experienceSection.title, false);
    fieldRow('experienceSection.subtitle', 'Experience section subtitle', data.experienceSection && data.experienceSection.subtitle, true);

    fieldRow('stats.projects', 'Projects stat (e.g. 50+)', data.stats && data.stats.projects, false);
    fieldRow('stats.experience', 'Experience stat', data.stats && data.stats.experience, false);
    fieldRow('stats.clients', 'Clients stat', data.stats && data.stats.clients, false);
    fieldRow('stats.awards', 'Awards stat', data.stats && data.stats.awards, false);

    fieldRow('metrics.projects', 'Metrics: Projects line', data.metrics && data.metrics.projects, false);
    fieldRow('metrics.clients', 'Metrics: Clients line', data.metrics && data.metrics.clients, false);
    fieldRow('metrics.awards', 'Metrics: Awards line', data.metrics && data.metrics.awards, false);

    // Project breakdown (name | count text | percent per line)
    fieldRow('projectBreakdownText', 'Project breakdown (name | count text | percent per line)',
      (data.projectBreakdown || []).map(p => `${p.name || ''} | ${p.countText || ''} | ${typeof p.percentage === 'number' ? p.percentage : ''}`).join('\n'),
      true
    );

    // Lists below use helper parsing on save
    const careerInitial = Array.isArray(data.career)
      ? data.career.join('\n').replace(/\\n/g, '\n')
      : '';
    fieldRow('careerText', 'Career Journey (one entry per line)', careerInitial, true);
    fieldRow('techStackText', 'Tech Stack (one tool per line)', (data.techStack || []).join('\n'), true);
    fieldRow('recognitionText', 'Latest Recognition (icon | title | event | image-url | link per line)',
      (data.recognition || []).map(r => `${r.icon || ''} | ${r.title || ''} | ${r.event || ''} | ${r.imageUrl || ''} | ${r.link || ''}`).join('\\n'),
      true
    );

    // Visual Latest Recognition editor (per-item rows + image upload)
    const recTextEl = portfolioFormEl.querySelector('[data-key="recognitionText"]');
    let recognitionItems = Array.isArray(data.recognition)
      ? data.recognition.map(r => ({
          icon: r.icon || '',
          title: r.title || '',
          event: r.event || '',
          imageUrl: r.imageUrl || '',
          link: r.link || ''
        }))
      : [];

    // If no structured array but raw text exists, parse it once so editor has something to show
    if (!recognitionItems.length && recTextEl && recTextEl.value && recTextEl.value.trim()) {
      try {
        const lines = recTextEl.value.split('\\n').map(s => s.trim()).filter(Boolean);
        recognitionItems = lines.map(line => {
          const parts = line.split('|').map(p => p.trim());
          return {
            icon: parts[0] || '',
            title: parts[1] || '',
            event: parts[2] || '',
            imageUrl: parts[3] || '',
            link: parts[4] || ''
          };
        });
      } catch {
        // ignore parse errors; stay on empty list
      }
    }

    // Keep live portfolio in sync with the editor
    if (!livePortfolio || typeof livePortfolio !== 'object') livePortfolio = {};
    livePortfolio.recognition = recognitionItems.map(r => ({ ...r }));

    const recognitionWrapper = document.createElement('div');
    recognitionWrapper.className = 'field-group';
    recognitionWrapper.innerHTML = `
      <label>Latest Recognition (visual editor)</label>
      <p style="font-size:0.8rem;color:#aaa;margin-bottom:0.5rem;">
        Manage your awards as individual cards. Each row controls icon, title, event, optional image and link.
        The underlying text field above is kept in sync automatically when you edit here.
      </p>
      <div id="recognition-editor-list" class="list" style="margin-top:0.5rem;"></div>
      <button type="button" id="recognition-add-btn" class="btn-secondary-admin" style="margin-top:0.75rem;">+ Add recognition</button>
    `;
    portfolioFormEl.appendChild(recognitionWrapper);

    const recognitionListEl = recognitionWrapper.querySelector('#recognition-editor-list');
    const recognitionAddBtn = recognitionWrapper.querySelector('#recognition-add-btn');

    function syncRecognitionTextFromEditor() {
      if (!recTextEl) return;
      const lines = recognitionItems.map(r => [
        r.icon || '',
        r.title || '',
        r.event || '',
        r.imageUrl || '',
        r.link || ''
      ].join(' | '));
      recTextEl.value = lines.join('\\n');
      // Also keep structured array up-to-date so previews and saves use the same data
      livePortfolio.recognition = recognitionItems.map(r => ({ ...r }));
      recTextEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function renderRecognitionList() {
      if (!recognitionListEl) return;
      recognitionListEl.innerHTML = '';

      if (!recognitionItems.length) {
        const empty = document.createElement('p');
        empty.style.color = '#9ca3af';
        empty.style.fontSize = '0.85rem';
        empty.textContent = 'No recognition items yet. Click "+ Add recognition" to create your first award.';
        recognitionListEl.appendChild(empty);
        return;
      }

      recognitionItems.forEach((rec, index) => {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.setAttribute('data-recognition-index', String(index));

        row.innerHTML = `
          <div class="list-item-main">
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:flex-start;">
              <input data-field="icon" placeholder="Icon (emoji)" value="${rec.icon || ''}"
                     style="flex:0.4 1 70px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.85rem;" />
              <input data-field="title" placeholder="Title" value="${rec.title || ''}"
                     style="flex:1 1 160px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.85rem;" />
              <input data-field="event" placeholder="Event / Year" value="${rec.event || ''}"
                     style="flex:1 1 140px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;" />
            </div>
            <div style="margin-top:0.4rem;display:flex;flex-direction:column;gap:0.4rem;">
              <input data-field="link" placeholder="External link (optional)" value="${rec.link || ''}"
                     style="width:100%;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;" />
              <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">
                <input data-field="imageUrl" placeholder="Image URL (optional)" value="${rec.imageUrl || ''}"
                       style="flex:1 1 160px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;" />
                <button type="button" data-action="upload-image"
                        style="padding:0.35rem 0.6rem;border-radius:6px;border:none;background:#3b82f6;color:#fff;font-size:0.75rem;cursor:pointer;">Upload image</button>
                <input type="file" data-upload="image" accept="image/*" style="display:none" />
                <img data-preview="image" src="${rec.imageUrl || ''}"
                     style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:1px solid #333;${rec.imageUrl ? '' : 'display:none;'}" />
              </div>
            </div>
          </div>
          <div class="list-item-actions">
            <button type="button" data-action="remove-recognition"
                    style="padding:0.3rem 0.6rem;border-radius:6px;border:none;background:#ef4444;color:#fff;font-size:0.75rem;cursor:pointer;">Delete</button>
          </div>
        `;

        // Text fields
        row.querySelectorAll('[data-field]').forEach(input => {
          const field = input.getAttribute('data-field');
          const handler = () => {
            const target = recognitionItems[index] || (recognitionItems[index] = {});
            target[field] = input.value;
            syncRecognitionTextFromEditor();
          };
          input.addEventListener('input', handler);
        });

        // Image upload
        const uploadBtn = row.querySelector('[data-action="upload-image"]');
        const fileInput = row.querySelector('[data-upload="image"]');
        const previewImg = row.querySelector('[data-preview="image"]');
        const imageField = row.querySelector('[data-field="imageUrl"]');

        if (uploadBtn && fileInput && imageField) {
          uploadBtn.addEventListener('click', () => fileInput.click());
          fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            uploadBtn.disabled = true;
            uploadFileToServer(file, 'images')
              .then(info => {
                const url = (info && (info.url || info.fileName)) || '';
                if (!url) return;
                imageField.value = url;
                if (previewImg) {
                  previewImg.src = url;
                  previewImg.style.display = 'block';
                }
                const target = recognitionItems[index] || (recognitionItems[index] = {});
                target.imageUrl = url;
                syncRecognitionTextFromEditor();
              })
              .catch(() => {
                alert('Failed to upload recognition image.');
              })
              .finally(() => {
                uploadBtn.disabled = false;
                fileInput.value = '';
              });
          });
        }

        const removeBtn = row.querySelector('[data-action="remove-recognition"]');
        if (removeBtn) {
          removeBtn.addEventListener('click', () => {
            recognitionItems.splice(index, 1);
            renderRecognitionList();
            syncRecognitionTextFromEditor();
          });
        }

        recognitionListEl.appendChild(row);
      });
    }

    if (recognitionAddBtn && !recognitionAddBtn.__bound) {
      recognitionAddBtn.__bound = true;
      recognitionAddBtn.addEventListener('click', () => {
        recognitionItems.push({ icon: '🏆', title: '', event: '', imageUrl: '', link: '' });
        renderRecognitionList();
        syncRecognitionTextFromEditor();
      });
    }

    renderRecognitionList();

    const testimonialsInitial = (data.testimonials || []).map(t => `${t.quote || ''} | ${t.author || ''}`).join('\\n');
    fieldRow('testimonialsText', 'Testimonials (quote | author per line)',
      testimonialsInitial.replace(/\\n/g, '\n'),
      true
    );

    // Client highlights: title | comment | comment author | platform | post URL | thumbnail per line
    const clientHighlightsInitial = (data.clientHighlights || []).map(ch =>
      [
        ch.title || '',
        ch.commentText || ch.quote || '',
        ch.commentAuthor || ch.author || '',
        ch.platform || '',
        ch.postUrl || '',
        ch.thumbnail || ''
      ].join(' | ')
    ).join('\n');
    fieldRow('clientHighlightsText', 'Client highlights (title | comment | comment author | platform | post URL | thumbnail per line)',
      clientHighlightsInitial.replace(/\\n/g, '\n'),
      true
    );

    // Services row (icon | title | description | type(link/video) | linkOrFile per line)
    const servicesRowInitial = (data.servicesRow || [])
      .map(s => `${s.icon || ''} | ${s.title || ''} | ${s.description || ''} | ${s.type || ''} | ${s.link || s.videoFile || ''}`)
      .join('\n');
    fieldRow('servicesRowText', 'Services row (icon | title | description | type | link-or-file per line)',
      servicesRowInitial.replace(/\\n/g, '\n'),
      true
    );

    // Projects editor (each line becomes a card on the portfolio)
    if (!Array.isArray(livePortfolio.projects)) {
      livePortfolio.projects = data.projects && Array.isArray(data.projects) ? data.projects : [];
    }

    const projectsWrapper = document.createElement('div');
    projectsWrapper.className = 'field-group';
    projectsWrapper.innerHTML = `
      <label>Projects (cards)</label>
      <p style="font-size:0.8rem;color:#aaa;margin-bottom:0.5rem;">
        Edit each project card that appears in the Professional Journey section. You can change title, description,
        video/link, thumbnail, and stats for every card, and add new ones.
      </p>
      <div id="projects-editor-list" class="list" style="margin-top:0.5rem;"></div>
      <button type="button" id="projects-add-btn" class="btn-secondary-admin" style="margin-top:0.75rem;">+ Add project</button>
    `;
    portfolioFormEl.appendChild(projectsWrapper);

    const projectsListEl = projectsWrapper.querySelector('#projects-editor-list');
    const addProjectBtn = projectsWrapper.querySelector('#projects-add-btn');

    function renderProjectsList() {
      projectsListEl.innerHTML = '';
      const projects = Array.isArray(livePortfolio.projects) ? livePortfolio.projects : [];
      projects.forEach((p, index) => {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.setAttribute('data-project-row', index);
        row.innerHTML = `
          <div class="list-item-main">
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:flex-start;">
              <input data-field="title" placeholder="Title" value="${p.title || ''}"
                     style="flex:2;min-width:160px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.85rem;" />
              <select data-field="type"
                      style="flex:1;min-width:100px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.85rem;">
                <option value="link" ${p.type === 'video' ? '' : 'selected'}>Link</option>
                <option value="video" ${p.type === 'video' ? 'selected' : ''}>Video file</option>
              </select>
              <input data-field="views" placeholder="Views text" value="${p.views || ''}"
                     style="flex:1;min-width:120px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;" />
              <input data-field="engagement" placeholder="Engagement text" value="${p.engagement || ''}"
                     style="flex:1;min-width:140px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;" />
            </div>
            <div style="margin-top:0.4rem;display:flex;flex-direction:column;gap:0.4rem;">
              <input data-field="linkOrFile" placeholder="Video file URL or external link" value="${(p.type === 'video' ? p.videoFile : p.link) || ''}"
                     style="width:100%;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;" />
              <input data-field="thumbnail" placeholder="Thumbnail image URL" value="${p.thumbnail || ''}"
                     style="width:100%;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;" />

              <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">
                <button type="button" data-action="upload-thumb"
                        style="padding:0.35rem 0.6rem;border-radius:6px;border:none;background:#3b82f6;color:#fff;font-size:0.75rem;cursor:pointer;">Upload thumbnail</button>
                <input type="file" data-upload="thumb" accept="image/*" style="display:none" />

                <button type="button" data-action="upload-video"
                        style="padding:0.35rem 0.6rem;border-radius:6px;border:none;background:#7c3aed;color:#fff;font-size:0.75rem;cursor:pointer;">Upload video</button>
                <input type="file" data-upload="video" accept="video/*" style="display:none" />

                <span data-upload-status style="font-size:0.75rem;color:#9ca3af;"></span>
              </div>

              <textarea data-field="description" placeholder="Description" rows="2"
                        style="width:100%;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;resize:vertical;">${p.description || ''}</textarea>
            </div>
          </div>
          <div class="list-item-actions">
            <button type="button" data-action="remove"
                    style="padding:0.3rem 0.6rem;border-radius:6px;border:none;background:#ef4444;color:#fff;font-size:0.75rem;cursor:pointer;">Delete</button>
          </div>
        `;

        row.querySelectorAll('[data-field]').forEach(input => {
          const field = input.getAttribute('data-field');
          const handler = () => {
            const value = input.value;
            if (!Array.isArray(livePortfolio.projects)) livePortfolio.projects = [];
            const target = livePortfolio.projects[index] || (livePortfolio.projects[index] = {});
            if (field === 'linkOrFile') {
              const type = (target.type || 'link');
              if (type === 'video') {
                target.videoFile = value;
                delete target.link;
              } else {
                target.link = value;
                delete target.videoFile;
              }
            } else if (field === 'type') {
              target.type = value || 'link';
              const linkOrFileInput = row.querySelector('[data-field="linkOrFile"]');
              if (linkOrFileInput) {
                const current = linkOrFileInput.value;
                if (target.type === 'video') {
                  target.videoFile = current;
                  delete target.link;
                } else {
                  target.link = current;
                  delete target.videoFile;
                }
              }
            } else {
              target[field] = value;
            }
            updatePreviewFromForm();
          };
          input.addEventListener('input', handler);
          if (input.tagName === 'SELECT') {
            input.addEventListener('change', handler);
          }
        });

        // Per-card upload handlers
        const statusEl = row.querySelector('[data-upload-status]');
        const thumbBtn = row.querySelector('[data-action="upload-thumb"]');
        const thumbInput = row.querySelector('[data-upload="thumb"]');
        const videoBtn = row.querySelector('[data-action="upload-video"]');
        const videoInput = row.querySelector('[data-upload="video"]');

        const setStatus = (text) => {
          if (statusEl) statusEl.textContent = text || '';
        };

        if (thumbBtn && thumbInput) {
          thumbBtn.addEventListener('click', () => thumbInput.click());
          thumbInput.addEventListener('change', () => {
            const file = thumbInput.files && thumbInput.files[0];
            if (!file) return;
            setStatus('Uploading thumbnail...');
            thumbBtn.disabled = true;
            uploadFileToServer(file, 'images')
              .then(info => {
                const url = (info && (info.url || info.fileName)) || '';
                const thumbField = row.querySelector('[data-field="thumbnail"]');
                if (thumbField && url) {
                  thumbField.value = url;
                  thumbField.dispatchEvent(new Event('input', { bubbles: true }));
                }
                setStatus(url ? 'Thumbnail uploaded ✅' : 'Upload failed');
              })
              .catch(() => setStatus('Upload failed'))
              .finally(() => {
                thumbBtn.disabled = false;
                thumbInput.value = '';
                setTimeout(() => setStatus(''), 2500);
              });
          });
        }

        if (videoBtn && videoInput) {
          videoBtn.addEventListener('click', () => videoInput.click());
          videoInput.addEventListener('change', () => {
            const file = videoInput.files && videoInput.files[0];
            if (!file) return;
            setStatus('Uploading video...');
            videoBtn.disabled = true;
            uploadFileToServer(file, 'videos')
              .then(info => {
                const url = (info && (info.url || info.fileName)) || '';

                // Switch card to "video" type automatically and fill linkOrFile
                const typeSelect = row.querySelector('[data-field="type"]');
                if (typeSelect) {
                  typeSelect.value = 'video';
                  typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }

                const linkOrFileField = row.querySelector('[data-field="linkOrFile"]');
                if (linkOrFileField && url) {
                  linkOrFileField.value = url;
                  linkOrFileField.dispatchEvent(new Event('input', { bubbles: true }));
                }

                setStatus(url ? 'Video uploaded ✅' : 'Upload failed');
              })
              .catch(() => setStatus('Upload failed'))
              .finally(() => {
                videoBtn.disabled = false;
                videoInput.value = '';
                setTimeout(() => setStatus(''), 2500);
              });
          });
        }

        const removeBtn = row.querySelector('[data-action="remove"]');
        if (removeBtn) {
          removeBtn.addEventListener('click', () => {
            if (!Array.isArray(livePortfolio.projects)) return;
            livePortfolio.projects.splice(index, 1);
            renderProjectsList();
            updatePreviewFromForm();
          });
        }

        projectsListEl.appendChild(row);
      });
    }

    if (addProjectBtn) {
      addProjectBtn.addEventListener('click', () => {
        if (!Array.isArray(livePortfolio.projects)) livePortfolio.projects = [];
        livePortfolio.projects.push({
          title: '',
          description: '',
          type: 'link',
          views: '',
          engagement: '',
          link: '',
          thumbnail: ''
        });
        renderProjectsList();
        updatePreviewFromForm();
      });
    }

    renderProjectsList();

    // Projects section heading
    fieldRow('projectsSection.title', 'Projects section title', data.projectsSection && data.projectsSection.title, false);
    fieldRow('projectsSection.subtitle', 'Projects section subtitle', data.projectsSection && data.projectsSection.subtitle, true);

    fieldRow('contact.title', 'Contact section title', data.contact && data.contact.title, false);
    fieldRow('contact.subtitle', 'Contact section subtitle', data.contact && data.contact.subtitle, true);
    fieldRow('contact.infoHeading', 'Contact info heading', data.contact && data.contact.infoHeading, false);
    fieldRow('contact.infoBody', 'Contact info body', data.contact && data.contact.infoBody, true);
    fieldRow('contact.socialHeading', 'Social heading', data.contact && data.contact.socialHeading, false);

    fieldRow('contact.details.email', 'Contact email', data.contact && data.contact.details && data.contact.details.email, false);
    fieldRow('contact.details.phone', 'Contact phone', data.contact && data.contact.details && data.contact.details.phone, false);
    fieldRow('contact.details.location', 'Contact location', data.contact && data.contact.details && data.contact.details.location, false);

    // Footer
    fieldRow('footer.name', 'Footer name', data.footer && data.footer.name, false);
    fieldRow('footer.role', 'Footer role', data.footer && data.footer.role, false);
    fieldRow('footer.copyright', 'Footer copyright text', data.footer && data.footer.copyright, false);

    // Theme colors
    fieldRow('theme.primary', 'Primary accent color (e.g. #7c3aed)', data.theme && data.theme.primary, false);
    fieldRow('theme.secondary', 'Secondary accent color (e.g. #3b82f6)', data.theme && data.theme.secondary, false);
    fieldRow('theme.background', 'Background color (e.g. #000000)', data.theme && data.theme.background, false);
    fieldRow('theme.text', 'Base text color (e.g. #ffffff)', data.theme && data.theme.text, false);

    // File upload controls for key images
    addUploadControl('hero.image', 'Upload hero image (replaces hero placeholder)', 'image/*', 'images');
    addUploadControl('about.mainImage', 'Upload about main image', 'image/*', 'images');
    addUploadControl('about.smallImage', 'Upload about secondary image', 'image/*', 'images');

    portfolioFormEl.querySelectorAll('input,textarea').forEach(el => {
      el.addEventListener('input', updatePreviewFromForm);
    });

    updatePreviewFromForm();
  }

  function setDeep(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function applyVirtualFieldsFromForm(clone) {
    // Navigation menu (label | href per line)
    const navEl = portfolioFormEl.querySelector('[data-key="navigationMenuText"]');
    if (navEl) {
      const menu = navEl.value.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
        const parts = line.split('|').map(p => p.trim());
        return { label: parts[0] || '', href: parts[1] || '#' };
      });
      if (!clone.navigation || typeof clone.navigation !== 'object') clone.navigation = {};
      clone.navigation.menu = menu;
    }

    // Project breakdown (name | count text | percent per line)
    const pbEl = portfolioFormEl.querySelector('[data-key="projectBreakdownText"]');
    if (pbEl) {
      const items = pbEl.value.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
        const parts = line.split('|').map(p => p.trim());
        return {
          name: parts[0] || '',
          countText: parts[1] || '',
          percentage: parts[2] ? Number(parts[2]) || 0 : 0
        };
      });
      clone.projectBreakdown = items;
    }

    // Career (array of strings)
    const careerEl = portfolioFormEl.querySelector('[data-key="careerText"]');
    if (careerEl) {
      const lines = careerEl.value.split('\n').map(s => s.trim()).filter(Boolean);
      clone.career = lines;
    }
    // Tech stack (array of strings)
    const techEl = portfolioFormEl.querySelector('[data-key="techStackText"]');
    if (techEl) {
      const tools = techEl.value.split('\n').map(s => s.trim()).filter(Boolean);
      clone.techStack = tools;
    }
    // Recognition (icon | title | event per line)
    const recEl = portfolioFormEl.querySelector('[data-key="recognitionText"]');
    if (recEl) {
      const items = recEl.value.split('\\n').map(s => s.trim()).filter(Boolean).map(line => {
        const parts = line.split('|').map(p => p.trim());
        return {
          icon: parts[0] || '',
          title: parts[1] || '',
          event: parts[2] || '',
          imageUrl: parts[3] || '',
          link: parts[4] || ''
        };
      });
      clone.recognition = items;
    }
    // Testimonials (quote | author per line)
    const testEl = portfolioFormEl.querySelector('[data-key="testimonialsText"]');
    if (testEl) {
      const items = testEl.value.split('\\n').map(s => s.trim()).filter(Boolean).map(line => {
        const parts = line.split('|').map(p => p.trim());
        return { quote: parts[0] || '', author: parts[1] || '' };
      });
      clone.testimonials = items;
    }
    // Client highlights (title | comment | comment author | platform | post URL | thumbnail per line)
    const chEl = portfolioFormEl.querySelector('[data-key="clientHighlightsText"]');
    if (chEl) {
      const items = chEl.value.split('\\n').map(s => s.trim()).filter(Boolean).map(line => {
        const parts = line.split('|').map(p => p.trim());
        return {
          title: parts[0] || '',
          commentText: parts[1] || '',
          commentAuthor: parts[2] || '',
          platform: parts[3] || '',
          postUrl: parts[4] || '',
          thumbnail: parts[5] || ''
        };
      });
      clone.clientHighlights = items;
    }

    // Services row (icon | title | description | type | link-or-file per line)
    const svcEl = portfolioFormEl.querySelector('[data-key="servicesRowText"]');
    if (svcEl) {
      const items = svcEl.value.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
        const parts = line.split('|').map(p => p.trim());
        const type = parts[3] || 'link';
        const linkOrFile = parts[4] || '';
        const base = { icon: parts[0] || '', title: parts[1] || '', description: parts[2] || '', type };
        if (type === 'video') {
          return { ...base, videoFile: linkOrFile };
        }
        return { ...base, link: linkOrFile };
      });
      clone.servicesRow = items;
    }
  }

  function applyProjectsFromEditor(clone) {
    const listEl = document.getElementById('projects-editor-list');
    if (!listEl) return;
    const rows = listEl.querySelectorAll('[data-project-row]');
    const projects = [];
    rows.forEach(row => {
      const get = (name) => {
        const el = row.querySelector(`[data-field="${name}"]`);
        return el ? el.value : '';
      };
      const type = get('type') || 'link';
      const linkOrFile = get('linkOrFile') || '';
      const proj = {
        title: get('title'),
        description: get('description'),
        type,
        views: get('views'),
        engagement: get('engagement')
      };
      if (type === 'video' && linkOrFile) {
        proj.videoFile = linkOrFile;
      } else if (linkOrFile) {
        proj.link = linkOrFile;
      }
      const thumb = get('thumbnail');
      if (thumb) proj.thumbnail = thumb;
      projects.push(proj);
    });
    clone.projects = projects;
  }

  function updatePreviewFromForm() {
    const clone = JSON.parse(JSON.stringify(livePortfolio || {}));
    portfolioFormEl.querySelectorAll('input,textarea').forEach(el => {
      const key = el.getAttribute('data-key');
      if (!key) return;
      setDeep(clone, key, el.value);
    });
    applyVirtualFieldsFromForm(clone);
    applyProjectsFromEditor(clone);

    const title = (clone.personal && clone.personal.title) || '';
    const desc = (clone.personal && clone.personal.description) || '';
    const aboutTitle = (clone.about && clone.about.title) || '';
    const aboutIntro = (clone.about && clone.about.intro) || '';

    portfolioPreviewEl.innerHTML = `
      <h3 style="margin-bottom:0.5rem;">Hero</h3>
      <div style="padding:0.75rem 1rem;border-radius:10px;background:#050505;border:1px solid #333;margin-bottom:1rem;">
        <div style="font-weight:600;margin-bottom:0.25rem;">${title.replace(/\n/g, '<br>')}</div>
        <div style="font-size:0.85rem;color:#aaa;">${desc}</div>
      </div>
      <h3 style="margin-top:1rem;margin-bottom:0.5rem;">About</h3>
      <div style="padding:0.75rem 1rem;border-radius:10px;background:#050505;border:1px solid #333;">
        <div style="font-weight:600;margin-bottom:0.25rem;">${aboutTitle}</div>
        <div style="font-size:0.85rem;color:#aaa;margin-bottom:0.5rem;">${aboutIntro}</div>
      </div>
    `;
  }

  function getFormPortfolioData() {
    const clone = JSON.parse(JSON.stringify(livePortfolio || {}));
    portfolioFormEl.querySelectorAll('input,textarea').forEach(el => {
      const key = el.getAttribute('data-key');
      if (!key) return;
      setDeep(clone, key, el.value);
    });
    applyVirtualFieldsFromForm(clone);
    applyProjectsFromEditor(clone);
    return clone;
  }

  function loadPortfolio() {
    fetch('/portfolio_data.json?' + Date.now())
      .then(res => res.json())
      .then(data => {
        buildPortfolioForm(data || {});
      })
      .catch(() => {
        buildPortfolioForm({});
      });
  }

  document.getElementById('save-portfolio').addEventListener('click', () => {
    const data = getFormPortfolioData();
    api('/api/portfolio', { method: 'PUT', json: data })
      .then(() => {
        try {
          // Trigger realtime update in any open portfolio tab
          localStorage.setItem('vr_portfolio_live_data', JSON.stringify(data));
        } catch (e) {
          console.warn('Failed to write live portfolio data to localStorage', e);
        }
        alert('Portfolio saved. Any open portfolio tab will update automatically.');
        loadPortfolio();
      })
      .catch(() => alert('Failed to save portfolio.'));
  });

  document.getElementById('reload-portfolio').addEventListener('click', () => {
    loadPortfolio();
  });

  // Messages
  const messagesListEl = document.getElementById('messages-list');

  function loadMessages() {
    api('/api/messages')
      .then(msgs => {
        messagesListEl.innerHTML = '';
        (msgs || []).slice().reverse().forEach(m => {
          const item = document.createElement('div');
          item.className = 'list-item';

          const main = document.createElement('div');
          main.className = 'list-item-main';

          const titleRow = document.createElement('div');
          titleRow.style.fontWeight = '600';

          const nameSpan = document.createElement('span');
          nameSpan.textContent = `${m.first_name || ''} ${m.last_name || ''}`.trim();

          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = m.read ? 'Read' : 'New';
          badge.style.color = m.read ? '#22c55e' : '#f97316';
          badge.style.borderColor = m.read ? '#22c55e' : '#f97316';

          titleRow.appendChild(nameSpan);
          titleRow.appendChild(badge);

          const email = document.createElement('div');
          email.style.fontSize = '0.8rem';
          email.style.color = '#aaa';
          email.style.margin = '0.15rem 0';
          email.textContent = m.email || '';

          const subject = document.createElement('div');
          subject.style.fontSize = '0.85rem';
          subject.style.marginTop = '0.25rem';
          subject.textContent = m.subject || '';

          const message = document.createElement('div');
          message.style.fontSize = '0.8rem';
          message.style.color = '#ccc';
          message.style.marginTop = '0.25rem';
          message.style.whiteSpace = 'pre-wrap';
          message.textContent = m.message || '';

          const meta = document.createElement('div');
          meta.style.fontSize = '0.75rem';
          meta.style.color = '#94a3b8';
          meta.style.marginTop = '0.35rem';
          meta.textContent = m.createdAt ? `Received: ${m.createdAt}` : '';

          main.appendChild(titleRow);
          main.appendChild(email);
          main.appendChild(subject);
          main.appendChild(message);
          if (m.createdAt) main.appendChild(meta);

          const actions = document.createElement('div');
          actions.className = 'list-item-actions';

          const readBtn = document.createElement('button');
          readBtn.textContent = 'Mark read';
          readBtn.style.padding = '0.3rem 0.6rem';
          readBtn.style.borderRadius = '6px';
          readBtn.style.border = 'none';
          readBtn.style.background = '#22c55e';
          readBtn.style.color = '#000';
          readBtn.style.fontSize = '0.75rem';

          const delBtn = document.createElement('button');
          delBtn.textContent = 'Delete';
          delBtn.style.padding = '0.3rem 0.6rem';
          delBtn.style.borderRadius = '6px';
          delBtn.style.border = 'none';
          delBtn.style.background = '#ef4444';
          delBtn.style.color = '#fff';
          delBtn.style.fontSize = '0.75rem';

          readBtn.addEventListener('click', () => {
            api('/api/messages/' + m.id, { method: 'PATCH', json: { read: true } })
              .then(loadMessages);
          });

          delBtn.addEventListener('click', () => {
            if (!confirm('Delete this message?')) return;
            api('/api/messages/' + m.id, { method: 'DELETE' })
              .then(loadMessages);
          });

          actions.appendChild(readBtn);
          actions.appendChild(delBtn);

          item.appendChild(main);
          item.appendChild(actions);
          messagesListEl.appendChild(item);
        });
      })
      .catch(() => {
        messagesListEl.innerHTML = '<p style="color:#f87171;font-size:0.85rem;">Failed to load messages.</p>';
      });
  }

  // Invoices
  const invoiceFormEl = document.getElementById('invoice-form');
  const invoicesListEl = document.getElementById('invoices-list');

  // --- Security tab ---
  function initSecurityTab() {
    // Password change
    const btn = document.getElementById('btn-change-password');
    const status = document.getElementById('pwd-status');
    const cur = document.getElementById('pwd-current');
    const nw = document.getElementById('pwd-new');
    const confirm = document.getElementById('pwd-new-confirm');

    if (btn && !btn.__bound) {
      btn.__bound = true;
      btn.addEventListener('click', () => {
        if (status) status.textContent = '';
        const currentPassword = (cur && cur.value || '').trim();
        const newPassword = (nw && nw.value || '').trim();
        const confirmPassword = (confirm && confirm.value || '').trim();

        if (!currentPassword) {
          if (status) status.textContent = 'Enter your current password.';
          return;
        }
        if (newPassword.length < 8) {
          if (status) status.textContent = 'New password must be at least 8 characters.';
          return;
        }
        if (newPassword !== confirmPassword) {
          if (status) status.textContent = 'New password and confirm password do not match.';
          return;
        }

        btn.disabled = true;
        api('/api/admin/password', {
          method: 'POST',
          json: { currentPassword, newPassword }
        })
          .then(() => {
            if (status) status.style.color = '#22c55e';
            if (status) status.textContent = 'Password updated successfully.';
            if (cur) cur.value = '';
            if (nw) nw.value = '';
            if (confirm) confirm.value = '';
          })
          .catch(() => {
            if (status) status.style.color = '#f87171';
            if (status) status.textContent = 'Failed to update password. Check current password.';
          })
          .finally(() => {
            btn.disabled = false;
            setTimeout(() => {
              if (status) status.style.color = '#9ca3af';
            }, 1500);
          });
      });
    }

    // Logo upload: uploads to /uploads/branding and updates preview + topbar logo.
    const logoUpload = document.getElementById('logo-upload');
    const logoPreview = document.getElementById('logo-preview');
    const topLogo = document.getElementById('admin-logo');

    const setLogo = (url) => {
      if (logoPreview && url) logoPreview.src = url;
      if (topLogo && url) topLogo.src = url;
      // Store into live portfolio so it is saved with Save Changes.
      try {
        if (!livePortfolio || typeof livePortfolio !== 'object') livePortfolio = {};
        if (!livePortfolio.adminConfig || typeof livePortfolio.adminConfig !== 'object') livePortfolio.adminConfig = {};
        if (!livePortfolio.adminConfig.branding || typeof livePortfolio.adminConfig.branding !== 'object') {
          livePortfolio.adminConfig.branding = {};
        }
        livePortfolio.adminConfig.branding.logoUrl = url;
      } catch (e) {
        // ignore
      }
    };

    // Prefer saved logoUrl if present
    try {
      const saved = livePortfolio && livePortfolio.adminConfig && livePortfolio.adminConfig.branding && livePortfolio.adminConfig.branding.logoUrl;
      if (saved) setLogo(saved);
    } catch {}

    if (topLogo && !topLogo.__bound) {
      topLogo.__bound = true;
      topLogo.addEventListener('error', () => {
        topLogo.style.display = 'none';
      });
    }
    if (logoPreview && !logoPreview.__bound) {
      logoPreview.__bound = true;
      logoPreview.addEventListener('error', () => {
        logoPreview.style.opacity = '0.35';
      });
    }

    if (logoUpload && !logoUpload.__bound) {
      logoUpload.__bound = true;
      logoUpload.addEventListener('change', () => {
        const file = logoUpload.files && logoUpload.files[0];
        if (!file) return;
        logoUpload.disabled = true;
        uploadFileToServer(file, 'branding')
          .then(info => {
            const url = (info && (info.url || info.fileName)) || '';
            if (!url) throw new Error('no-url');
            setLogo(url);
            alert('Logo uploaded. Now click "Save Changes" in the Portfolio tab to persist it.');
          })
          .catch(() => alert('Failed to upload logo.'))
          .finally(() => {
            logoUpload.value = '';
            logoUpload.disabled = false;
          });
      });
    }
  }

  // --- AI tools & learning hub ---
  const DEFAULT_AI_TOOLS_DATA = [
    {
      category: 'AI Video Editing',
      tools: [
        { name: 'Runway ML', url: 'https://runwayml.com/', description: 'Gen-2 / Gen-4 video generation, background removal, AI VFX.' },
        { name: 'Pika Labs', url: 'https://pika.art/', description: 'AI video generation and editing with physics-aware motion.' },
        { name: 'Descript', url: 'https://www.descript.com/', description: 'Text-based video editing, AI overdub, auto-cut, studio sound.' },
        { name: 'VEED.IO', url: 'https://www.veed.io/', description: 'Online AI video editor, subtitles, templates and avatars.' },
        { name: 'Kapwing', url: 'https://www.kapwing.com/', description: 'AI repurposing, script generator, dubbing and B-roll.' },
        { name: 'CapCut', url: 'https://www.capcut.com/', description: 'All-in-one AI editor for auto captions, TTS and video upscaling.' },
        { name: 'Opus Clip', url: 'https://www.opus.pro/', description: 'Turns long-form videos into viral short clips automatically.' }
      ]
    },
    {
      category: 'Audio Cleanup & Voice',
      tools: [
        { name: 'Adobe Podcast Enhance', url: 'https://podcast.adobe.com/enhance', description: 'AI speech enhancement for cleaner dialog.' },
        { name: 'Krisp AI', url: 'https://krisp.ai/', description: 'Real-time noise cancellation and echo removal.' },
        { name: 'Auphonic', url: 'https://auphonic.com/', description: 'AI audio leveling, noise & reverb reduction.' },
        { name: 'ElevenLabs', url: 'https://elevenlabs.io/', description: 'High quality AI voice cloning and TTS (great for dubbing).' }
      ]
    },
    {
      category: 'Subtitles & Transcription',
      tools: [
        { name: 'Rev AI', url: 'https://www.rev.com/ai', description: 'Professional-grade transcription and subtitles.' },
        { name: 'CapCut Auto Captions', url: 'https://www.capcut.com/', description: 'Automatic captions for social video.' },
        { name: 'SubtitleBee', url: 'https://www.subtitlebee.com/', description: 'Multi-language subtitles with style controls.' }
      ]
    },
    {
      category: 'Color Grading & Upscaling',
      tools: [
        { name: 'Topaz Video AI', url: 'https://www.topazlabs.com/video-ai', description: 'AI upscaling, enhancement and stabilization.' },
        { name: 'DaVinci Resolve Neural Engine', url: 'https://www.blackmagicdesign.com/products/davinciresolve/', description: 'Built-in AI tools for color, subtitles and editing.' },
        { name: 'HitPaw AI', url: 'https://www.hitpaw.com/', description: 'AI enhancement for photos and videos.' }
      ]
    },
    {
      category: 'VFX, Motion & Design',
      tools: [
        { name: 'Adobe After Effects (AI)', url: 'https://www.adobe.com/products/aftereffects.html', description: 'AI-assisted motion graphics and effects.' },
        { name: 'Midjourney', url: 'https://www.midjourney.com/', description: 'AI image generation for concept art and thumbnails.' },
        { name: 'Adobe Express with Firefly', url: 'https://www.adobe.com/express/', description: 'Quick social designs and thumbnails with generative AI.' }
      ]
    },
    {
      category: 'Scripting & Ideas',
      tools: [
        { name: 'ChatGPT (Video Script Generator)', url: 'https://chat.openai.com/', description: 'Generate scripts, shot lists and ideas from prompts.' },
        { name: 'Writesonic', url: 'https://writesonic.com/', description: 'AI content and SEO assist for titles, descriptions and blogs.' }
      ]
    }
  ];

  const LEARNING_ARTICLES = {
    video: [
      {
        title: 'DaVinci Resolve 20 – AI tools overview',
        source: 'Blackmagic Design',
        url: 'https://www.blackmagicdesign.com/products/davinciresolve/'
      },
      {
        title: 'Adobe Premiere & After Effects workflow tips',
        source: 'Adobe',
        url: 'https://www.adobe.com/products/aftereffects.html'
      },
      {
        title: 'Video marketing in the AI era',
        source: 'VEED Blog',
        url: 'https://www.veed.io/'
      },
      {
        title: 'Sound design & cleanup for creators',
        source: 'Descript Guides',
        url: 'https://www.descript.com/'
      }
    ],
    cyber: [
      {
        title: 'OWASP Top 10 – Web security basics',
        source: 'OWASP',
        url: 'https://owasp.org/'
      },
      {
        title: 'Intro to cybersecurity paths & careers',
        source: 'freeCodeCamp',
        url: 'https://www.freecodecamp.org/news/tag/cybersecurity/'
      },
      {
        title: 'NIST Cybersecurity Framework (overview)',
        source: 'NIST',
        url: 'https://www.nist.gov/cyberframework'
      },
      {
        title: 'Hardening your personal devices',
        source: 'Kaspersky Academy',
        url: 'https://www.kaspersky.com/resource-center'
      }
    ]
  };

  // --- Client Reviews tab (clientHighlights editor) ---
  let reviewsTabInitialised = false;

  function ensureClientHighlightsArray() {
    if (!livePortfolio || typeof livePortfolio !== 'object') livePortfolio = {};
    if (!Array.isArray(livePortfolio.clientHighlights)) livePortfolio.clientHighlights = [];
  }

  function buildReviewsList() {
    ensureClientHighlightsArray();
    const list = document.getElementById('reviews-editor-list');
    if (!list) return;
    list.innerHTML = '';

    const items = livePortfolio.clientHighlights;
    if (!items.length) {
      const empty = document.createElement('p');
      empty.style.color = '#9ca3af';
      empty.style.fontSize = '0.85rem';
      empty.textContent = 'No reviews yet. Click "+ Add review" to create your first client highlight card.';
      list.appendChild(empty);
      updateReviewsPreview();
      return;
    }

    items.forEach((rev, index) => {
      const row = document.createElement('div');
      row.className = 'list-item';
      row.setAttribute('data-review-index', String(index));

      row.innerHTML = `
        <div class="list-item-main">
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:flex-start;">
            <input data-field="title" placeholder="Card title" value="${rev.title || ''}"
                   style="flex:1 1 180px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.85rem;" />
            <input data-field="platform" placeholder="Platform (Instagram, YouTube, etc.)" value="${rev.platform || ''}"
                   style="flex:1 1 140px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;" />
          </div>
          <div style="margin-top:0.4rem;display:flex;flex-direction:column;gap:0.4rem;">
            <input data-field="postUrl" placeholder="Post / reel / video URL" value="${rev.postUrl || ''}"
                   style="width:100%;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;" />
            <textarea data-field="commentText" rows="2" placeholder="Best comment or review text"
                      style="width:100%;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;resize:vertical;">${rev.commentText || ''}</textarea>
            <input data-field="commentAuthor" placeholder="Comment / client name" value="${rev.commentAuthor || ''}"
                   style="width:100%;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;" />
          </div>
        </div>
        <div class="list-item-actions">
          <button type="button" data-action="remove-review"
                  style="padding:0.3rem 0.6rem;border-radius:6px;border:none;background:#ef4444;color:#fff;font-size:0.75rem;cursor:pointer;">Delete</button>
        </div>
      `;

      row.querySelectorAll('[data-field]').forEach(input => {
        const field = input.getAttribute('data-field');
        const handler = () => {
          ensureClientHighlightsArray();
          const target = livePortfolio.clientHighlights[index] || (livePortfolio.clientHighlights[index] = {});
          target[field] = input.value;
          updateReviewsPreview();
        };
        input.addEventListener('input', handler);
      });

      const removeBtn = row.querySelector('[data-action="remove-review"]');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          ensureClientHighlightsArray();
          livePortfolio.clientHighlights.splice(index, 1);
          buildReviewsList();
        });
      }

      list.appendChild(row);
    });

    updateReviewsPreview();
  }

  function updateReviewsPreview() {
    const box = document.getElementById('reviews-preview');
    if (!box) return;
    ensureClientHighlightsArray();
    const items = livePortfolio.clientHighlights;
    if (!items.length) {
      box.innerHTML = '<p style="font-size:0.85rem;color:#9ca3af;">No reviews to preview yet.</p>';
      return;
    }
    const lines = items.map(r => {
      const name = r.commentAuthor || 'Client';
      const platform = r.platform ? ` · ${r.platform}` : '';
      return `“${(r.commentText || '').slice(0, 120)}${(r.commentText || '').length > 120 ? '…' : ''}” — ${name}${platform}`;
    });
    box.innerHTML = '<ul style="list-style:none;padding-left:0;margin:0;font-size:0.85rem;color:#e5e7eb;">' +
      lines.map(t => `<li style=\"margin-bottom:0.4rem;\">${t}</li>`).join('') +
      '</ul>';
  }

  function collectClientHighlightsFromEditor() {
    ensureClientHighlightsArray();
    const list = document.getElementById('reviews-editor-list');
    if (!list) return livePortfolio.clientHighlights;
    const rows = list.querySelectorAll('[data-review-index]');
    const next = [];
    rows.forEach(row => {
      const get = (field) => {
        const el = row.querySelector(`[data-field="${field}"]`);
        return el ? el.value : '';
      };
      const obj = {
        title: get('title'),
        platform: get('platform'),
        postUrl: get('postUrl'),
        commentText: get('commentText'),
        commentAuthor: get('commentAuthor')
      };
      // Skip completely empty rows
      if (obj.title || obj.postUrl || obj.commentText || obj.commentAuthor || obj.platform) {
        next.push(obj);
      }
    });
    livePortfolio.clientHighlights = next;
    return next;
  }

  function initReviewsTab() {
    if (reviewsTabInitialised) {
      buildReviewsList();
      return;
    }
    reviewsTabInitialised = true;

    const addBtn = document.getElementById('reviews-add');
    const saveBtn = document.getElementById('reviews-save');
    const reloadBtn = document.getElementById('reviews-reload');

    if (addBtn && !addBtn.__bound) {
      addBtn.__bound = true;
      addBtn.addEventListener('click', () => {
        ensureClientHighlightsArray();
        livePortfolio.clientHighlights.push({
          title: 'Clients Success Highlight',
          platform: '',
          postUrl: '',
          commentText: '',
          commentAuthor: ''
        });
        buildReviewsList();
      });
    }

    if (saveBtn && !saveBtn.__bound) {
      saveBtn.__bound = true;
      saveBtn.addEventListener('click', () => {
        try {
          collectClientHighlightsFromEditor();
          const payload = JSON.parse(JSON.stringify(livePortfolio || {}));
          api('/api/portfolio', { method: 'PUT', json: payload })
            .then(() => {
              try {
                localStorage.setItem('vr_portfolio_live_data', JSON.stringify(payload));
              } catch {}
              alert('Client reviews saved. The public site will update on next refresh.');
            })
            .catch(() => alert('Failed to save client reviews.'));
        } catch (e) {
          alert('Failed to prepare client reviews payload.');
        }
      });
    }

    if (reloadBtn && !reloadBtn.__bound) {
      reloadBtn.__bound = true;
      reloadBtn.addEventListener('click', () => {
        fetch('/portfolio_data.json?' + Date.now())
          .then(res => res.json())
          .then(data => {
            livePortfolio = data || {};
            buildReviewsList();
          })
          .catch(() => alert('Failed to reload live portfolio data.'));
      });
    }

    buildReviewsList();
  }

  // Invoice system configuration (fixed per spec)
  const INVOICE_COMPANY_NAME = 'VR PRODUCTIONS';
  const INVOICE_COMPANY_ADDRESS = 'Nagpur, Maharashtra, India';
  const INVOICE_COMPANY_CITY_LINE = 'Nagpur, Maharashtra, India';
  const INVOICE_TAX_PERCENT = 10;
  const INVOICE_CURRENCY = 'US$'; // default; admin can override per invoice
  const INVOICE_PAYMENT_NOTE = 'Please pay within 15 days of receiving this invoice.';

  function buildInvoiceForm() {
    if (!invoiceFormEl) return;
    invoiceFormEl.innerHTML = `
      <div class="field-group">
        <h2 style="margin:0 0 0.5rem 0;">Billing & Invoice Management</h2>
        <p style="font-size:0.85rem;color:#aaa;">Create clean, client-ready invoices that match your VR PRODUCTIONS template.</p>
      </div>
      <input id="inv_project_name" type="hidden" value="Invoice" />
      <input id="inv_project_id" type="hidden" />
      <div class="two-column">
        <div>
          <h3>Client & Invoice Details</h3>
          <div class="field-group">
            <label for="inv_client_name">Client / Company Name</label>
            <input id="inv_client_name" type="text" />
          </div>
          <div class="field-group">
            <label for="inv_client_address">Client Address</label>
            <input id="inv_client_address" type="text" />
          </div>
          <div class="field-group">
            <label for="inv_client_city">City / Country / PIN</label>
            <input id="inv_client_city" type="text" />
          </div>
          <div class="field-group">
            <label for="inv_invoice_date">Invoice Date</label>
            <input id="inv_invoice_date" type="text" placeholder="01 Jan, 2025" />
          </div>
          <div class="field-group">
            <label for="inv_due_date">Due Date</label>
            <input id="inv_due_date" type="text" placeholder="15 Jan, 2025" />
          </div>
          <div class="field-group">
            <label for="inv_reference">Reference (INV-XXX)</label>
            <input id="inv_reference" type="text" placeholder="INV-001" />
          </div>
          <div class="field-group">
            <label for="inv_currency">Currency (e.g. USD, INR, EUR)</label>
            <input id="inv_currency" type="text" placeholder="US$" />
          </div>
        </div>
        <div>
          <h3>Footer (per invoice)</h3>
          <div class="field-group">
            <label for="inv_footer_website">Website</label>
            <input id="inv_footer_website" type="text" placeholder="https://yourwebsite.com" />
          </div>
          <div class="field-group">
            <label for="inv_footer_phone">Phone</label>
            <input id="inv_footer_phone" type="text" placeholder="+91 00000 00000" />
          </div>
          <div class="field-group">
            <label for="inv_footer_email">Email</label>
            <input id="inv_footer_email" type="email" placeholder="hello@example.com" />
          </div>
        </div>
      </div>
      <div class="field-group">
        <h3>Line Items</h3>
        <p style="font-size:0.8rem;color:#aaa;margin-bottom:0.5rem;">Each row becomes one line in the invoice (Item, Qty, Rate, Line Total).</p>
        <div id="inv_services_list" class="list"></div>
        <button type="button" id="inv_add_service" class="btn-secondary-admin" style="margin-top:0.5rem;">+ Add item</button>
      </div>
      <div class="two-column">
        <div>
          <div class="field-group">
            <label for="inv_subtotal">Subtotal</label>
            <input id="inv_subtotal" type="text" readonly />
          </div>
          <div class="field-group">
            <label for="inv_tax_amount">Tax (10%)</label>
            <input id="inv_tax_amount" type="text" readonly />
          </div>
        </div>
        <div>
          <div class="field-group">
            <label for="inv_total">Total Due</label>
            <input id="inv_total" type="text" readonly />
          </div>
        </div>
      </div>
      <div class="field-group">
        <label for="inv_terms">Payment terms</label>
        <textarea id="inv_terms" rows="3">${INVOICE_PAYMENT_NOTE}</textarea>
      </div>
      <div class="field-group">
        <label for="inv_refund">Refund policy</label>
        <textarea id="inv_refund" rows="3">Refunds are handled on a case-by-case basis and are not guaranteed once work has started.</textarea>
      </div>
    `;

    // Lock system-defined fields so admin cannot change company / tax
    const setReadOnlyValue = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (typeof value === 'string') el.value = value;
      el.readOnly = true;
      el.style.opacity = '0.75';
      el.style.pointerEvents = 'none';
    };

    setReadOnlyValue('inv_tax_percent', String(INVOICE_TAX_PERCENT));

    // Currency: allow admin to choose, but default to INVOICE_CURRENCY if empty
    const currencyInput = document.getElementById('inv_currency');
    if (currencyInput && !currencyInput.value) {
      currencyInput.value = INVOICE_CURRENCY;
    }

    // Pre-fill invoice date with today if empty
    const invoiceDateInput = document.getElementById('inv_invoice_date');
    if (invoiceDateInput && !invoiceDateInput.value) {
      const now = new Date();
      invoiceDateInput.value = now.toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    }

    const servicesListEl = invoiceFormEl.querySelector('#inv_services_list');
    const addServiceBtn = invoiceFormEl.querySelector('#inv_add_service');

    function addServiceRow(initial) {
      const row = document.createElement('div');
      row.className = 'list-item';
      row.setAttribute('data-service-row', '1');
      const svc = initial || {};
      row.innerHTML = `
        <div class="list-item-main">
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:flex-start;">
            <input data-service-field="name" placeholder="Service name" value="${svc.name || ''}"
                   style="flex:2;min-width:160px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.85rem;" />
            <input data-service-field="quantity" placeholder="Qty" type="number" step="1" min="0" value="${svc.quantity != null ? svc.quantity : ''}"
                   style="flex:0.5;min-width:70px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.85rem;" />
            <input data-service-field="rate" placeholder="Rate" type="number" step="0.01" min="0" value="${svc.rate != null ? svc.rate : ''}"
                   style="flex:0.8;min-width:100px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.85rem;" />
            <input data-service-field="amount" placeholder="Amount" type="number" step="0.01" min="0" value="${svc.amount != null ? svc.amount : ''}"
                   style="flex:0.8;min-width:100px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.85rem;" />
          </div>
          <div style="margin-top:0.4rem;">
            <textarea data-service-field="description" rows="2" placeholder="Description"
                      style="width:100%;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.8rem;resize:vertical;">${svc.description || ''}</textarea>
          </div>
        </div>
        <div class="list-item-actions">
          <button type="button" data-action="remove-service"
                  style="padding:0.3rem 0.6rem;border-radius:6px;border:none;background:#ef4444;color:#fff;font-size:0.75rem;cursor:pointer;">Delete</button>
        </div>
      `;

      const qtyInput = row.querySelector('[data-service-field="quantity"]');
      const rateInput = row.querySelector('[data-service-field="rate"]');
      const amountInput = row.querySelector('[data-service-field="amount"]');
      const recalcRow = () => {
        const q = parseFloat(qtyInput.value || '0');
        const r = parseFloat(rateInput.value || '0');
        if (!isNaN(q) && !isNaN(r)) {
          const a = q * r;
          amountInput.value = a ? a.toFixed(2) : '';
        }
        recalcInvoiceSummary();
      };
      qtyInput.addEventListener('input', recalcRow);
      rateInput.addEventListener('input', recalcRow);
      amountInput.addEventListener('input', recalcInvoiceSummary);

      const removeBtn = row.querySelector('[data-action="remove-service"]');
      removeBtn.addEventListener('click', () => {
        row.remove();
        recalcInvoiceSummary();
      });

      servicesListEl.appendChild(row);
    }

    function recalcInvoiceSummary() {
      const rows = servicesListEl.querySelectorAll('[data-service-row]');
      let servicesSubtotal = 0;
      rows.forEach(row => {
        const amountInput = row.querySelector('[data-service-field="amount"]');
        const v = parseFloat((amountInput && amountInput.value) || '0');
        if (!isNaN(v)) servicesSubtotal += v;
      });
      const extraRevision = parseFloat((document.getElementById('inv_extra_revision') || {}).value || '0') || 0;
      const expressDelivery = parseFloat((document.getElementById('inv_express_delivery') || {}).value || '0') || 0;
      const addons = parseFloat((document.getElementById('inv_addons_amount') || {}).value || '0') || 0;
      const subtotal = servicesSubtotal + extraRevision + expressDelivery + addons;
      const subtotalInput = document.getElementById('inv_subtotal');
      if (subtotalInput) subtotalInput.value = subtotal.toFixed(2);

      const taxPercentInput = document.getElementById('inv_tax_percent');
      const taxAmountInput = document.getElementById('inv_tax_amount');
      const taxPercent = INVOICE_TAX_PERCENT;
      if (taxPercentInput) taxPercentInput.value = String(INVOICE_TAX_PERCENT);
      const taxAmount = subtotal * taxPercent / 100;
      if (taxAmountInput) taxAmountInput.value = taxAmount.toFixed(2);

      const discountInput = document.getElementById('inv_discount');
      const discount = 0;
      if (discountInput) discountInput.value = '0';

      const totalInput = document.getElementById('inv_total');
      const total = subtotal + taxAmount - discount;
      if (totalInput) totalInput.value = total.toFixed(2);
    }

    if (addServiceBtn) {
      addServiceBtn.addEventListener('click', () => {
        addServiceRow({});
        recalcInvoiceSummary();
      });
    }

    // Initial service row
    addServiceRow({});
    recalcInvoiceSummary();

  }

  function collectInvoiceFormData() {
    const getVal = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };

    const clientName = getVal('inv_client_name');
    if (!clientName) {
      alert('Client name is required.');
      return null;
    }

    const projectName = getVal('inv_project_name') || 'Invoice';

    let projectId = getVal('inv_project_id');
    if (!projectId) {
      projectId = 'AB' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.floor(Math.random() * 90 + 10);
    }

    const services = [];
    const servicesListEl = invoiceFormEl.querySelector('#inv_services_list');
    if (servicesListEl) {
      servicesListEl.querySelectorAll('[data-service-row]').forEach(row => {
        const getField = (name) => {
          const el = row.querySelector(`[data-service-field="${name}"]`);
          return el ? el.value.trim() : '';
        };
        const name = getField('name');
        const desc = getField('description');
        const qtyVal = getField('quantity');
        const rateVal = getField('rate');
        const amtVal = getField('amount');
        if (!name && !desc && !qtyVal && !rateVal && !amtVal) return;
        const quantity = qtyVal ? Number(qtyVal) || 0 : 0;
        const rate = rateVal ? Number(rateVal) || 0 : 0;
        const amount = amtVal ? Number(amtVal) || (quantity * rate) : (quantity * rate);
        services.push({ name, description: desc, quantity, rate, amount });
      });
    }

    if (!services.length) {
      alert('Add at least one service.');
      return null;
    }

    const extraRevision = Number(getVal('inv_extra_revision') || '0') || 0;
    const expressDelivery = Number(getVal('inv_express_delivery') || '0') || 0;
    const addonsAmount = Number(getVal('inv_addons_amount') || '0') || 0;
    const addonsDescription = getVal('inv_addons_description');

    const subtotal = Number(getVal('inv_subtotal') || '0') || 0;
    const taxPercent = Number(getVal('inv_tax_percent') || '0') || 0;
    const taxAmount = Number(getVal('inv_tax_amount') || '0') || 0;
    const discount = Number(getVal('inv_discount') || '0') || 0;
    const total = Number(getVal('inv_total') || '0') || 0;

    const paymentStatus = getVal('inv_payment_status') || 'unpaid';
    const paymentMethod = getVal('inv_payment_method') || '';

    const savedLogoUrl = (livePortfolio && livePortfolio.adminConfig && livePortfolio.adminConfig.branding && livePortfolio.adminConfig.branding.logoUrl) || '';

    const data = {
      clientName,
      clientEmail: getVal('inv_client_email'),
      clientPhone: getVal('inv_client_phone'),
      clientAddress: getVal('inv_client_address'),
      clientCity: getVal('inv_client_city'),
      projectName,
      projectId,
      reference: getVal('inv_reference'),
      invoiceDate: getVal('inv_invoice_date'),
      dueDate: getVal('inv_due_date'),
      services,
      additionalCharges: {
        extraRevision,
        expressDelivery,
        addonsAmount,
        addonsDescription
      },
      summary: {
        subtotal,
        taxPercent,
        taxAmount,
        discount,
        total
      },
      amount: total,
      currency: getVal('inv_currency') || INVOICE_CURRENCY,
      paymentStatus,
      status: paymentStatus,
      paymentMethod,
      notes: getVal('inv_notes'),
      footer: {
        logoUrl: savedLogoUrl,
        businessName: INVOICE_COMPANY_NAME,
        contact: getVal('inv_business_contact'),
        address: INVOICE_COMPANY_ADDRESS,
        city: INVOICE_COMPANY_CITY_LINE,
        taxId: getVal('inv_tax_id'),
        website: getVal('inv_footer_website'),
        email: getVal('inv_footer_email'),
        phone: getVal('inv_footer_phone'),
        terms: getVal('inv_terms'),
        refundPolicy: getVal('inv_refund')
      }
    };

    return data;
  }

  try {
    buildInvoiceForm();
  } catch (e) {
    console && console.error && console.error('Failed to initialize invoice form', e);
  }

  function ensureAdminConfig() {
    if (!livePortfolio || typeof livePortfolio !== 'object') livePortfolio = {};
    if (!livePortfolio.adminConfig || typeof livePortfolio.adminConfig !== 'object') {
      livePortfolio.adminConfig = {};
    }
    return livePortfolio.adminConfig;
  }

  function getAiToolsData() {
    const cfg = ensureAdminConfig();
    if (!Array.isArray(cfg.aiTools) || !cfg.aiTools.length) {
      cfg.aiTools = JSON.parse(JSON.stringify(DEFAULT_AI_TOOLS_DATA));
    }
    return cfg.aiTools;
  }

  function buildAiToolsSection() {
    const container = document.getElementById('ai-tools-container');
    const editor = document.getElementById('ai-tools-editor');
    const addCategoryBtn = document.getElementById('ai-add-category');
    const saveBtn = document.getElementById('ai-save');
    if (!container || !editor) return;

    const data = getAiToolsData();

    // --- Preview (right column) ---
    container.innerHTML = '';
    const sorted = data.slice().sort((a, b) => (Number(a.priority || 0) - Number(b.priority || 0)));

    sorted.forEach(group => {
      const header = document.createElement('h3');
      header.textContent = group.category || 'Category';
      header.style.margin = '0.25rem 0 0.5rem 0';
      header.style.fontSize = '0.95rem';
      header.style.color = '#e5e7eb';
      container.appendChild(header);

      (group.tools || []).forEach(tool => {
        const item = document.createElement('div');
        item.className = 'list-item';

        const main = document.createElement('div');
        main.className = 'list-item-main';

        const name = document.createElement('div');
        name.style.fontWeight = '600';
        name.style.fontSize = '0.95rem';
        name.textContent = tool.name || '';

        const desc = document.createElement('p');
        desc.style.fontSize = '0.8rem';
        desc.style.color = '#aaa';
        desc.style.margin = '0.35rem 0 0.4rem 0';
        desc.textContent = tool.description || '';

        const link = document.createElement('a');
        link.href = tool.url || '#';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.fontSize = '0.8rem';
        link.style.color = '#60a5fa';
        link.style.textDecoration = 'none';
        link.textContent = tool.url || '';

        main.appendChild(name);
        main.appendChild(desc);
        main.appendChild(link);
        item.appendChild(main);

        item.addEventListener('click', (e) => {
          if (e.target && e.target.tagName === 'A') return;
          if (tool.url) window.open(tool.url, '_blank');
        });

        container.appendChild(item);
      });
    });

    // --- Editor (left column) ---
    editor.innerHTML = '';

    data.forEach((group, groupIndex) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'list-item';

      const main = document.createElement('div');
      main.className = 'list-item-main';

      const headerRow = document.createElement('div');
      headerRow.style.display = 'flex';
      headerRow.style.flexWrap = 'wrap';
      headerRow.style.gap = '0.5rem';

      const catInput = document.createElement('input');
      catInput.value = group.category || '';
      catInput.placeholder = 'Category name';
      catInput.style.flex = '2';
      catInput.style.minWidth = '180px';
      catInput.style.padding = '0.4rem 0.6rem';
      catInput.style.borderRadius = '6px';
      catInput.style.border = '1px solid #333';
      catInput.style.background = '#000';
      catInput.style.color = '#fff';
      catInput.style.fontSize = '0.85rem';

      const prioInput = document.createElement('input');
      prioInput.type = 'number';
      prioInput.step = '1';
      prioInput.placeholder = 'Priority';
      prioInput.value = String(group.priority || 0);
      prioInput.style.flex = '1';
      prioInput.style.minWidth = '110px';
      prioInput.style.padding = '0.4rem 0.6rem';
      prioInput.style.borderRadius = '6px';
      prioInput.style.border = '1px solid #333';
      prioInput.style.background = '#000';
      prioInput.style.color = '#fff';
      prioInput.style.fontSize = '0.85rem';

      headerRow.appendChild(catInput);
      headerRow.appendChild(prioInput);
      main.appendChild(headerRow);

      const toolsWrap = document.createElement('div');
      toolsWrap.style.marginTop = '0.65rem';
      toolsWrap.style.display = 'flex';
      toolsWrap.style.flexDirection = 'column';
      toolsWrap.style.gap = '0.5rem';

      const tools = Array.isArray(group.tools) ? group.tools : (group.tools = []);
      tools.forEach((tool, toolIndex) => {
        const row = document.createElement('div');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '1fr 1fr';
        row.style.gap = '0.5rem';

        const nameInput = document.createElement('input');
        nameInput.placeholder = 'Tool name';
        nameInput.value = tool.name || '';
        nameInput.style.padding = '0.35rem 0.55rem';
        nameInput.style.borderRadius = '6px';
        nameInput.style.border = '1px solid #333';
        nameInput.style.background = '#000';
        nameInput.style.color = '#fff';
        nameInput.style.fontSize = '0.8rem';

        const urlInput = document.createElement('input');
        urlInput.placeholder = 'https://...';
        urlInput.value = tool.url || '';
        urlInput.style.padding = '0.35rem 0.55rem';
        urlInput.style.borderRadius = '6px';
        urlInput.style.border = '1px solid #333';
        urlInput.style.background = '#000';
        urlInput.style.color = '#fff';
        urlInput.style.fontSize = '0.8rem';

        const descInput = document.createElement('textarea');
        descInput.placeholder = 'Short description';
        descInput.rows = 2;
        descInput.value = tool.description || '';
        descInput.style.gridColumn = '1 / -1';
        descInput.style.padding = '0.35rem 0.55rem';
        descInput.style.borderRadius = '6px';
        descInput.style.border = '1px solid #333';
        descInput.style.background = '#000';
        descInput.style.color = '#fff';
        descInput.style.fontSize = '0.8rem';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = 'Delete tool';
        delBtn.style.padding = '0.3rem 0.6rem';
        delBtn.style.borderRadius = '6px';
        delBtn.style.border = 'none';
        delBtn.style.background = '#ef4444';
        delBtn.style.color = '#fff';
        delBtn.style.fontSize = '0.75rem';
        delBtn.style.cursor = 'pointer';
        delBtn.style.gridColumn = '1 / -1';
        delBtn.style.justifySelf = 'start';

        const sync = () => {
          tool.name = nameInput.value;
          tool.url = urlInput.value;
          tool.description = descInput.value;
        };

        nameInput.addEventListener('input', sync);
        urlInput.addEventListener('input', sync);
        descInput.addEventListener('input', sync);

        delBtn.addEventListener('click', () => {
          tools.splice(toolIndex, 1);
          buildAiToolsSection();
        });

        row.appendChild(nameInput);
        row.appendChild(urlInput);
        row.appendChild(descInput);
        row.appendChild(delBtn);
        toolsWrap.appendChild(row);
      });

      const addToolBtn = document.createElement('button');
      addToolBtn.type = 'button';
      addToolBtn.textContent = '+ Add tool';
      addToolBtn.className = 'btn-secondary-admin';
      addToolBtn.style.marginTop = '0.5rem';

      addToolBtn.addEventListener('click', () => {
        tools.push({ name: '', url: '', description: '' });
        buildAiToolsSection();
      });

      main.appendChild(toolsWrap);
      main.appendChild(addToolBtn);
      wrapper.appendChild(main);

      const actions = document.createElement('div');
      actions.className = 'list-item-actions';
      const delCatBtn = document.createElement('button');
      delCatBtn.type = 'button';
      delCatBtn.textContent = 'Delete';
      delCatBtn.style.padding = '0.3rem 0.6rem';
      delCatBtn.style.borderRadius = '6px';
      delCatBtn.style.border = 'none';
      delCatBtn.style.background = '#ef4444';
      delCatBtn.style.color = '#fff';
      delCatBtn.style.fontSize = '0.75rem';
      delCatBtn.style.cursor = 'pointer';
      delCatBtn.addEventListener('click', () => {
        data.splice(groupIndex, 1);
        buildAiToolsSection();
      });
      actions.appendChild(delCatBtn);
      wrapper.appendChild(actions);

      catInput.addEventListener('input', () => {
        group.category = catInput.value;
      });
      prioInput.addEventListener('input', () => {
        group.priority = Number(prioInput.value || 0) || 0;
      });

      editor.appendChild(wrapper);
    });

    if (addCategoryBtn && !addCategoryBtn.__bound) {
      addCategoryBtn.__bound = true;
      addCategoryBtn.addEventListener('click', () => {
        const d = getAiToolsData();
        d.push({ category: 'New Category', priority: d.length, tools: [] });
        buildAiToolsSection();
      });
    }

    if (saveBtn && !saveBtn.__bound) {
      saveBtn.__bound = true;
      saveBtn.addEventListener('click', () => {
        // Persist AI tools inside portfolio_data.json
        api('/api/portfolio', { method: 'PUT', json: livePortfolio })
          .then(() => {
            alert('AI tools saved.');
          })
          .catch(() => alert('Failed to save AI tools.'));
      });
    }
  }

  function buildLearningHub() {
    const videoList = document.getElementById('learning-video');
    const cyberList = document.getElementById('learning-cyber');
    if (!videoList || !cyberList) return;

    const buildList = (target, items) => {
      target.innerHTML = '';
      items.forEach(article => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
          <div class="list-item-main">
            <div style="font-weight:600;font-size:0.9rem;">${article.title}</div>
            <div style="font-size:0.8rem;color:#9ca3af;margin-top:0.15rem;">${article.source}</div>
            <a href="${article.url}" target="_blank" rel="noopener noreferrer"
               style="display:inline-block;margin-top:0.4rem;font-size:0.8rem;color:#60a5fa;text-decoration:none;">Open article</a>
          </div>
        `;
        item.addEventListener('click', (e) => {
          if (e.target && e.target.tagName === 'A') return;
          window.open(article.url, '_blank');
        });
        target.appendChild(item);
      });
    };

    buildList(videoList, LEARNING_ARTICLES.video || []);
    buildList(cyberList, LEARNING_ARTICLES.cyber || []);

  }

  function loadInvoices() {
    api('/api/invoices')
      .then(invs => {
        invoicesListEl.innerHTML = '';
        (invs || []).slice().reverse().forEach(inv => {
          const clientName = inv.clientName || '';
          const invoiceNumber = inv.projectId || inv.invoiceNumber || inv.id;
          const total = (inv.summary && inv.summary.total) || inv.total || inv.amount || 0;
          const currency = inv.currency || '';
          const invoiceDate = inv.invoiceDate || (inv.createdAt || '').slice(0, 10);

          const item = document.createElement('div');
          item.className = 'list-item';
          item.innerHTML = `
            <div class="list-item-main">
              <div style="font-weight:600;font-size:0.95rem;">Invoice #${invoiceNumber || ''}</div>
              <div style="font-size:0.85rem;color:#e5e7eb;margin-top:0.15rem;">${clientName}</div>
              <div style="font-size:0.8rem;color:#9ca3af;margin-top:0.25rem;">${invoiceDate || ''}</div>
              <div style="font-size:0.9rem;color:#cbd5e1;margin-top:0.35rem;">
                <span style="font-weight:600;">${currency}</span>
                <span style="font-weight:600;">${total}</span>
              </div>
            </div>
            <div class="list-item-actions">
              <button style="padding:0.3rem 0.6rem;border-radius:6px;border:none;background:#3b82f6;color:#fff;font-size:0.75rem;" data-action="pdf">Download PDF</button>
              <button style="padding:0.3rem 0.6rem;border-radius:6px;border:none;background:#ef4444;color:#fff;font-size:0.75rem;" data-action="delete">Delete</button>
            </div>
          `;
          item.querySelectorAll('[data-action]').forEach(btn => {
            const action = btn.getAttribute('data-action');
            if (action === 'pdf') {
              btn.addEventListener('click', () => {
                downloadInvoicePdf(inv.id);
              });
            } else if (action === 'delete') {
              btn.addEventListener('click', () => {
                if (!confirm('Delete this invoice?')) return;
                api('/api/invoices/' + inv.id, { method: 'DELETE' })
                  .then(loadInvoices);
              });
            }
          });
          invoicesListEl.appendChild(item);
        });
      })
      .catch(() => {
        invoicesListEl.innerHTML = '<p style="color:#f87171;font-size:0.85rem;">Failed to load invoices.</p>';
      });
  }

  function downloadInvoicePdf(id) {
    fetch('/api/invoices/' + id + '/pdf', {
      headers: authToken ? { 'Authorization': 'Bearer ' + authToken } : {}
    })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = id + '.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(() => alert('Failed to download invoice PDF.'));
  }

  function handleCreateInvoiceClick() {
    const data = collectInvoiceFormData();
    if (!data) return;
    api('/api/invoices', { method: 'POST', json: data })
      .then(() => {
        alert('Invoice created.');
        try { buildInvoiceForm(); } catch (e) {
          console && console.error && console.error('Failed to rebuild invoice form', e);
        }
        loadInvoices();
      })
      .catch(() => alert('Failed to create invoice.'));
  }

  const createInvoiceBtn = document.getElementById('create-invoice');
  if (createInvoiceBtn) {
    createInvoiceBtn.addEventListener('click', handleCreateInvoiceClick);
  }

  // Fallback: event delegation in case the button is re-rendered dynamically
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('#create-invoice') : null;
    if (!btn) return;
    handleCreateInvoiceClick();
  });
})();
