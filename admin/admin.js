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
      recognition: document.getElementById('tab-recognition'),
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
        if (tab === 'recognition') initRecognitionTab();
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

    // Technical Expertise (skills: name + percentage) — new visual editor
    if (!Array.isArray(livePortfolio.skills)) {
      livePortfolio.skills = Array.isArray(data.skills) ? data.skills : [];
    }

    const skillsWrapper = document.createElement('div');
    skillsWrapper.className = 'field-group';
    skillsWrapper.innerHTML = `
      <label>Technical Expertise</label>
      <p style="font-size:0.8rem;color:#aaa;margin-bottom:0.5rem;">
        Add your core skills with proficiency. Each row is a skill name and percentage.
      </p>
      <div id="skills-editor-list" class="list" style="margin-top:0.5rem;"></div>
      <button type="button" id="skills-add-btn" class="btn-secondary-admin" style="margin-top:0.75rem;">+ Add skill</button>
    `;
    portfolioFormEl.appendChild(skillsWrapper);

    const skillsListEl = skillsWrapper.querySelector('#skills-editor-list');
    const addSkillBtn = skillsWrapper.querySelector('#skills-add-btn');

    function renderSkillsList() {
      if (!skillsListEl) return;
      skillsListEl.innerHTML = '';

      const items = livePortfolio.skills || [];
      if (!items.length) {
        const empty = document.createElement('p');
        empty.style.color = '#9ca3af';
        empty.style.fontSize = '0.85rem';
        empty.textContent = 'No skills yet. Click "+ Add skill" to create your first entry.';
        skillsListEl.appendChild(empty);
        return;
      }

      items.forEach((skill, index) => {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.setAttribute('data-skill-index', String(index));
        row.innerHTML = `
          <div class="list-item-main">
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:flex-start;">
              <input data-field="name" placeholder="Skill name" value="${skill.name || ''}"
                     style="flex:1 1 180px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.85rem;" />
              <input data-field="percentage" placeholder="Percentage" type="number" min="0" max="100" step="1" value="${typeof skill.percentage === 'number' ? skill.percentage : ''}"
                     style="flex:0.4 1 120px;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid #333;background:#000;color:#fff;font-size:0.85rem;" />
            </div>
          </div>
          <div class="list-item-actions">
            <button type="button" data-action="remove-skill"
                    style="padding:0.3rem 0.6rem;border-radius:6px;border:none;background:#ef4444;color:#fff;font-size:0.75rem;cursor:pointer;">Delete</button>
          </div>
        `;

        row.querySelectorAll('[data-field]').forEach(input => {
          const field = input.getAttribute('data-field');
          input.addEventListener('input', () => {
            const target = livePortfolio.skills[index] || (livePortfolio.skills[index] = {});
            target[field] = field === 'percentage' ? Number(input.value || '0') || 0 : input.value;
          });
        });

        const removeBtn = row.querySelector('[data-action="remove-skill"]');
        if (removeBtn) {
          removeBtn.addEventListener('click', () => {
            livePortfolio.skills.splice(index, 1);
            renderSkillsList();
          });
        }

        skillsListEl.appendChild(row);
      });
    }

    if (addSkillBtn && !addSkillBtn.__bound) {
      addSkillBtn.__bound = true;
      addSkillBtn.addEventListener('click', () => {
        if (!Array.isArray(livePortfolio.skills)) livePortfolio.skills = [];
        livePortfolio.skills.push({ name: '', percentage: 0 });
        renderSkillsList();
      });
    }

    renderSkillsList();

    // Services row (icon | title | description | type(link/video) | linkOrFile per line)
    const servicesRowInitial = (data.servicesRow || []).map(s => [
      s.icon || '',
      s.title || '',
      s.description || '',
      s.type || 'link',
      s.type === 'video' ? (s.videoFile || '') : (s.link || '')
    ].join(' | ')).join('\n');
    fieldRow('servicesRowText', 'Services row (icon | title | description | type(link/video) | linkOrFile per line)',
      servicesRowInitial.replace(/\n/g, '\n'),
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

    // Recognition parsing removed: use dedicated Recognition tab data (livePortfolio.recognition)
    // Do not override recognition from the Portfolio tab.
    if (Array.isArray(livePortfolio.recognition)) {
      clone.recognition = livePortfolio.recognition.map(r => ({ ...r }));
    }

    // Services row (icon | title | description | type | link-or-file per line)
    const svcEl = portfolioFormEl.querySelector('[data-key="servicesRowText"]');
    if (svcEl) {
      const items = svcEl.value.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
        const parts = line.split('|').map(p => p.trim());
        const type = (parts[3] || 'link').toLowerCase() === 'video' ? 'video' : 'link';
        const obj = {
          icon: parts[0] || '',
          title: parts[1] || '',
          description: parts[2] || '',
          type
        };
        if (type === 'video') obj.videoFile = parts[4] || '';
        else obj.link = parts[4] || '';
        return obj;
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
  function loadInvoices() {
    const formEl = document.getElementById('invoice-form');
    const listEl = document.getElementById('invoices-list');
    const createBtn = document.getElementById('create-invoice');
    if (!formEl || !listEl || !createBtn) return;

    formEl.innerHTML = `
      <div class="field-group"><label>Client / Company Name</label><input id="inv-client-name" type="text" placeholder="Client or company name" /></div>
      <div class="field-group"><label>Client Address</label><input id="inv-client-address" type="text" placeholder="Street, area" /></div>
      <div class="field-group"><label>City / Country / PIN</label><input id="inv-client-city" type="text" placeholder="City / Country / PIN" /></div>

      <div class="field-group"><label>Invoice Date</label><input id="inv-invoice-date" type="date" /></div>
      <div class="field-group"><label>Due Date</label><input id="inv-due-date" type="date" /></div>
      <div class="field-group"><label>Reference (INV-XXX)</label><input id="inv-reference" type="text" placeholder="INV-001" /></div>
      <div class="field-group"><label>Currency (e.g. USD, INR, EUR)</label><input id="inv-currency" type="text" placeholder="USD" /></div>

      <div class="field-group"><label>Website</label><input id="inv-footer-website" type="url" placeholder="https://yourwebsite.com" /></div>
      <div class="field-group"><label>Phone</label><input id="inv-footer-phone" type="text" placeholder="+91 00000 00000" /></div>
      <div class="field-group"><label>Email</label><input id="inv-footer-email" type="email" placeholder="hello@example.com" /></div>

      <div class="field-group">
        <label>Line Items</label>
        <p style="font-size:0.85rem;color:#999;">Each row becomes one line in the invoice (Item, Qty, Rate, Line Total).</p>
        <div id="inv-items" class="list" style="display:flex;flex-direction:column;gap:8px;"></div>
        <button id="inv-add-item" type="button" class="btn-secondary-admin" style="margin-top:6px;">+ Add item</button>
      </div>

      <div class="field-group" style="display:grid; grid-template-columns: 1.5fr 1fr; gap:12px;">
        <div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
            <div><label>Subtotal</label><input id="inv-subtotal" type="number" step="0.01" readonly /></div>
            <div><label>Tax (%)</label><input id="inv-tax-percent" type="number" step="0.01" value="10" /></div>
            <div><label>Tax Amount</label><input id="inv-tax-amount" type="number" step="0.01" readonly /></div>
            <div><label>Total Due</label><input id="inv-total" type="number" step="0.01" readonly /></div>
          </div>
        </div>
        <div>
          <label>Payment terms</label>
          <textarea id="inv-terms" rows="2" placeholder="Please pay within 15 days of receiving this invoice."></textarea>
          <label style="margin-top:8px;">Refund policy</label>
          <textarea id="inv-refund" rows="3" placeholder="Refunds are handled on a case-by-case basis and are not guaranteed once work has started."></textarea>
        </div>
      </div>
    `;

    const itemsEl = document.getElementById('inv-items');
    const addItemBtn = document.getElementById('inv-add-item');
    const subtotalEl = document.getElementById('inv-subtotal');
    const taxPercentEl = document.getElementById('inv-tax-percent');
    const taxAmountEl = document.getElementById('inv-tax-amount');
    const totalEl = document.getElementById('inv-total');

    function addItemRow(init = { name: '', quantity: 1, rate: 0, description: '' }) {
      const row = document.createElement('div');
      row.dataset.itemRow = 'true'; // mark as a line-item row
      row.style = 'display:grid; grid-template-columns: 2fr 0.8fr 0.8fr 1fr auto; gap:8px; align-items:center;';
      const name = document.createElement('input'); name.type = 'text'; name.placeholder = 'Service name'; name.value = init.name;
      const qty = document.createElement('input'); qty.type = 'number'; qty.min = '0'; qty.placeholder = 'Qty'; qty.value = String(init.quantity);
      const rate = document.createElement('input'); rate.type = 'number'; rate.min = '0'; rate.placeholder = 'Rate'; rate.value = String(init.rate);
      const amount = document.createElement('input'); amount.type = 'number'; amount.step = '0.01'; amount.placeholder = 'Amount'; amount.readOnly = true;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn-secondary-admin'; del.textContent = 'Delete';

      const desc = document.createElement('textarea');
      desc.dataset.itemDesc = 'true'; // mark the description paired with row
      desc.rows = 2; desc.placeholder = 'Description'; desc.value = init.description;
      desc.style = 'grid-column: 1 / -2; margin-top:6px;';

      const computeAmount = () => {
        const a = (Number(qty.value || 0) * Number(rate.value || 0));
        amount.value = a.toFixed(2);
        recomputeTotals();
      };
      qty.addEventListener('input', computeAmount);
      rate.addEventListener('input', computeAmount);
      name.addEventListener('input', recomputeTotals);
      desc.addEventListener('input', recomputeTotals);

      del.addEventListener('click', () => { row.remove(); desc.remove(); recomputeTotals(); });

      computeAmount();
      row.appendChild(name); row.appendChild(qty); row.appendChild(rate); row.appendChild(amount); row.appendChild(del);
      itemsEl.appendChild(row);
      itemsEl.appendChild(desc);
    }

    function recomputeTotals() {
      const rows = itemsEl.querySelectorAll('[data-item-row="true"]');
      const amounts = Array.from(rows).map(r => {
        const inputs = r.querySelectorAll('input');
        const qty = Number(inputs[1]?.value || 0);
        const rate = Number(inputs[2]?.value || 0);
        return qty * rate;
      });
      const subtotal = amounts.reduce((s, v) => s + v, 0);
      const taxPercent = Number(taxPercentEl.value || 0);
      const taxAmount = (subtotal * taxPercent) / 100;
      const total = subtotal + taxAmount;

      subtotalEl.value = subtotal.toFixed(2);
      taxAmountEl.value = taxAmount.toFixed(2);
      totalEl.value = total.toFixed(2);
    }

    taxPercentEl.addEventListener('input', recomputeTotals);
    if (!itemsEl.querySelector('[data-item-row="true"]')) addItemRow();

    async function fetchInvoices() {
      try {
        const data = await api('/api/invoices');
        renderInvoicesList(Array.isArray(data) ? data : []);
      } catch {
        renderInvoicesList([]);
      }
    }

    function renderInvoicesList(items) {
      listEl.innerHTML = '';
      items.forEach(inv => {
        const card = document.createElement('div');
        card.style = 'border:1px solid #333;padding:10px;border-radius:8px;background:#111;margin-bottom:10px;';
        const title = document.createElement('div');
        title.style = 'font-weight:600;margin-bottom:6px;';
        title.textContent = `${inv.clientName || ''} — ${inv.projectName || ''}`;
        const meta = document.createElement('div');
        meta.style = 'color:#999;margin-bottom:8px;';
        meta.textContent = `Total: ${(inv.summary?.total ?? 0)} ${inv.currency || ''} • Due: ${inv.dueDate || '-'}`;
        const actions = document.createElement('div');
        actions.style = 'display:flex;gap:8px;';
        const pdfBtn = document.createElement('a');
        pdfBtn.className = 'btn-secondary-admin';
        pdfBtn.href = `/api/invoices/${encodeURIComponent(inv.id)}/pdf`;
        pdfBtn.target = '_blank';
        pdfBtn.textContent = 'Download PDF';
        const delBtn = document.createElement('button');
        delBtn.type = 'button'; delBtn.className = 'btn-secondary-admin'; delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', async () => {
          if (!confirm('Delete this invoice?')) return;
          try { await api(`/api/invoices/${encodeURIComponent(inv.id)}`, { method: 'DELETE' }); fetchInvoices(); }
          catch { alert('Failed to delete invoice (are you logged in?)'); }
        });
        actions.appendChild(pdfBtn);
        actions.appendChild(delBtn);
        card.appendChild(title); card.appendChild(meta); card.appendChild(actions);
        listEl.appendChild(card);
      });
    }

    if (addItemBtn && !addItemBtn._bound) {
      addItemBtn._bound = true;
      addItemBtn.addEventListener('click', () => addItemRow());
    }

    if (createBtn && !createBtn._bound) {
      createBtn._bound = true;
      createBtn.addEventListener('click', async () => {
        const clientName = document.getElementById('inv-client-name').value.trim();
        const clientAddress = document.getElementById('inv-client-address').value.trim();
        const clientCity = document.getElementById('inv-client-city').value.trim();
        const invoiceDate = document.getElementById('inv-invoice-date').value;
        const dueDate = document.getElementById('inv-due-date').value;
        const reference = document.getElementById('inv-reference').value.trim();
        const currency = document.getElementById('inv-currency').value.trim() || 'USD';

        const website = document.getElementById('inv-footer-website').value.trim();
        const phone = document.getElementById('inv-footer-phone').value.trim();
        const email = document.getElementById('inv-footer-email').value.trim();
        const terms = document.getElementById('inv-terms').value.trim();
        const refundPolicy = document.getElementById('inv-refund').value.trim();

        // Only pick row divs we created (robust selection)
        const rowsDivs = itemsEl.querySelectorAll('[data-item-row="true"]');
        const rowsDescs = itemsEl.querySelectorAll('[data-item-desc="true"]');

        const services = Array.from(rowsDivs).map((row, i) => {
          const inputs = row.querySelectorAll('input');
          let name = (inputs[0]?.value || '').trim();
          const quantity = Number(inputs[1]?.value || 0);
          const rate = Number(inputs[2]?.value || 0);
          const amount = quantity * rate;
          const description = (rowsDescs[i]?.value || '').trim();

          // Auto-fill name from description if blank to satisfy server schema
          if (!name && description) {
            name = description.length > 120 ? description.slice(0, 120) : description;
          }

          // Visual hint: flag rows with neither name nor description
          if (!name && !description) {
            row.style.outline = '1px solid #f87171';
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else {
            row.style.outline = '';
          }

          return { name, description, quantity, rate, amount };
        })
        // Server requires a non-empty name for each line item
        .filter(s => !!s.name)

        if (!clientName || services.length === 0) {
          alert('Client name and at least one line item are required.');
          return;
        }

        const subtotal = services.reduce((sum, s) => sum + (s.amount || 0), 0);
        const taxPercent = Number(taxPercentEl.value || 0);
        const taxAmount = (subtotal * taxPercent) / 100;
        const total = subtotal + taxAmount;

        const payload = {
          clientName,
          clientAddress,
          clientCity,
          projectName: reference || 'Invoice',
          reference,
          invoiceDate,
          dueDate,
          services,
          summary: { subtotal, taxPercent, taxAmount, discount: 0, total },
          currency,
          notes: '',
          footer: {
            website,
            email,
            phone,
            terms,
            refundPolicy
          }
        };

        try {
          await api('/api/invoices', { method: 'POST', json: payload });
          alert('Invoice created.');
          fetchInvoices();
        } catch {
          alert('Failed to create invoice. Please log in first.');
        }
      });
    }

    fetchInvoices();
  }

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
      }
    ],
    cyber: [
      {
        title: 'OWASP Top 10 for Web Applications',
        source: 'OWASP Foundation',
        url: 'https://owasp.org/www-project-top-ten/'
      },
      {
        title: 'Web Security: SameSite, CORS and CSRF explained',
        source: 'MDN Web Docs',
        url: 'https://developer.mozilla.org/en-US/docs/Web/Security'
      },
      {
        title: 'Content Security Policy (CSP) — a practical guide',
        source: 'Google Web Fundamentals',
        url: 'https://web.dev/articles/csp'
      },
      {
        title: 'JWT Best Practices — token storage and rotation',
        source: 'Auth0 Blog',
        url: 'https://auth0.com/blog/jwt-security-best-practices/'
      },
      {
        title: 'Secure file uploads — validation and scanning',
        source: 'OWASP Cheat Sheet',
        url: 'https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html'
      }
    ]
  };

function renderRecognitionTabList() {
  const listEl = document.getElementById('recognition-editor-list-tab');
  if (!listEl) return;

  if (!Array.isArray(livePortfolio.recognition)) {
    livePortfolio.recognition = [];
  }

  listEl.innerHTML = '';

  const makeRow = (labelText, inputEl) => {
    const wrap = document.createElement('div');
    wrap.style = 'margin-bottom:8px;';
    const label = document.createElement('label');
    label.textContent = labelText;
    label.style = 'display:block;font-size:0.85rem;color:#bbb;margin-bottom:4px;';
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    return wrap;
  };

  livePortfolio.recognition.forEach((item, idx) => {
    const card = document.createElement('div');
    card.style = 'border:1px solid #333;padding:12px;border-radius:8px;background:#111;margin-bottom:10px;';

    const iconInput = document.createElement('input');
    iconInput.type = 'text';
    iconInput.placeholder = 'Icon (emoji or text)';
    iconInput.value = item.icon || '';
    iconInput.style = 'width:100%;';
    iconInput.addEventListener('input', () => {
      livePortfolio.recognition[idx].icon = iconInput.value.trim();
      renderRecognitionPreview();
    });

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Title';
    titleInput.value = item.title || '';
    titleInput.style = 'width:100%;';
    titleInput.addEventListener('input', () => {
      livePortfolio.recognition[idx].title = titleInput.value.trim();
      renderRecognitionPreview();
    });

    const eventInput = document.createElement('input');
    eventInput.type = 'text';
    eventInput.placeholder = 'Event';
    eventInput.value = item.event || '';
    eventInput.style = 'width:100%;';
    eventInput.addEventListener('input', () => {
      livePortfolio.recognition[idx].event = eventInput.value.trim();
      renderRecognitionPreview();
    });

    const imageUrlInput = document.createElement('input');
    imageUrlInput.type = 'text';
    imageUrlInput.placeholder = 'Image URL';
    imageUrlInput.value = item.imageUrl || '';
    imageUrlInput.style = 'width:100%;';
    imageUrlInput.addEventListener('input', () => {
      livePortfolio.recognition[idx].imageUrl = imageUrlInput.value.trim();
      renderRecognitionPreview();
    });

    const imageFileInput = document.createElement('input');
    imageFileInput.type = 'file';
    imageFileInput.accept = 'image/*';
    imageFileInput.style = 'width:100%;';
    imageFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const result = await uploadFileToServer(file, 'images');
        if (result && result.url) {
          livePortfolio.recognition[idx].imageUrl = result.url;
          imageUrlInput.value = result.url;
          renderRecognitionPreview();
        } else {
          alert('Upload failed: no URL returned');
        }
      } catch {
        alert('Image upload failed. Please log in first.');
      }
    });

    const imagePreview = document.createElement('div');
    imagePreview.style = 'margin-top:6px;display:flex;align-items:center;gap:8px;';
    const previewImg = document.createElement('img');
    previewImg.src = item.imageUrl || '';
    previewImg.alt = 'Image preview';
    previewImg.style = 'max-height:60px;max-width:120px;border-radius:6px;border:1px solid #333;';
    imagePreview.appendChild(previewImg);
    imageUrlInput.addEventListener('input', () => {
      previewImg.src = (livePortfolio.recognition[idx].imageUrl || '').trim();
    });

    const linkInput = document.createElement('input');
    linkInput.type = 'text';
    linkInput.placeholder = 'Link URL';
    linkInput.value = item.link || '';
    linkInput.style = 'width:100%;';
    linkInput.addEventListener('input', () => {
      livePortfolio.recognition[idx].link = linkInput.value.trim();
      renderRecognitionPreview();
    });

    const actions = document.createElement('div');
    actions.style = 'display:flex;gap:8px;justify-content:flex-end;margin-top:10px;';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-secondary-admin';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      livePortfolio.recognition.splice(idx, 1);
      renderRecognitionTabList();
    });
    actions.appendChild(deleteBtn);

    card.appendChild(makeRow('Icon', iconInput));
    card.appendChild(makeRow('Title', titleInput));
    card.appendChild(makeRow('Event', eventInput));
    card.appendChild(makeRow('Image URL', imageUrlInput));
    card.appendChild(makeRow('Select Image', imageFileInput));
    card.appendChild(imagePreview);
    card.appendChild(makeRow('Link', linkInput));
    card.appendChild(actions);

    listEl.appendChild(card);
  });

  renderRecognitionPreview();
}

function renderRecognitionPreview() {
  const previewEl = document.getElementById('recognition-preview');
  if (!previewEl) return;
  previewEl.innerHTML = '';

  livePortfolio.recognition.forEach((r) => {
    const row = document.createElement('div');
    row.style = 'padding:6px 8px;border-bottom:1px solid #222;';
    const icon = r.icon || '🏆';
    const title = r.title || '';
    const event = r.event ? ` — ${r.event}` : '';
    row.textContent = `${icon} ${title}${event}`;
    previewEl.appendChild(row);
  });
}

function initRecognitionTab() {
  const addBtn = document.getElementById('recognition-add');
  const saveBtn = document.getElementById('recognition-save');
  const reloadBtn = document.getElementById('recognition-reload');

  if (!Array.isArray(livePortfolio.recognition)) {
    livePortfolio.recognition = [];
  }

  renderRecognitionTabList();

  if (addBtn && !addBtn._bound) {
    addBtn._bound = true;
    addBtn.addEventListener('click', () => {
      livePortfolio.recognition.push({
        icon: '🏆',
        title: '',
        event: '',
        imageUrl: '',
        link: ''
      });
      renderRecognitionTabList();
    });
  }

  if (saveBtn && !saveBtn._bound) {
    saveBtn._bound = true;
    saveBtn.addEventListener('click', async () => {
      try {
        const clone = { ...livePortfolio };
        applyVirtualFieldsFromForm(clone);
        await api('/api/portfolio', { method: 'PUT', json: clone });
        alert('Recognition saved.');
      } catch (e) {
        alert('Save failed. Please log in first.');
      }
    });
  }

  if (reloadBtn && !reloadBtn._bound) {
    reloadBtn._bound = true;
    reloadBtn.addEventListener('click', async () => {
      try {
        const fresh = await api('/portfolio_data.json');
        if (fresh && typeof fresh === 'object') {
          livePortfolio = fresh;
          renderRecognitionTabList();
        }
      } catch (e) {
        alert('Failed to reload recognition.');
      }
    });
  }
}

function initReviewsTab() {
  const listEl = document.getElementById('reviews-editor-list');
  const addBtn = document.getElementById('reviews-add');
  const saveBtn = document.getElementById('reviews-save');
  const previewEl = document.getElementById('reviews-preview');

  if (!Array.isArray(livePortfolio.clientHighlights)) {
    livePortfolio.clientHighlights = [];
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';
    livePortfolio.clientHighlights.forEach((item, idx) => {
      const card = document.createElement('div');
      card.style = 'border:1px solid #333;padding:12px;border-radius:8px;background:#111;margin-bottom:10px;';

      const title = document.createElement('input');
      title.type = 'text'; title.placeholder = 'Clients Success Highlight'; title.value = item.title || '';
      title.style = 'width:100%; margin-bottom:8px;';
      title.addEventListener('input', () => { livePortfolio.clientHighlights[idx].title = title.value.trim(); renderPreview(); });

      const platform = document.createElement('input');
      platform.type = 'text'; platform.placeholder = 'Platform (Instagram, YouTube, etc.)'; platform.value = item.platform || '';
      platform.style = 'width:100%; margin-bottom:8px;';
      platform.addEventListener('input', () => { livePortfolio.clientHighlights[idx].platform = platform.value.trim(); renderPreview(); });

      const link = document.createElement('input');
      link.type = 'text'; link.placeholder = 'Post / reel / video URL'; link.value = item.link || '';
      link.style = 'width:100%; margin-bottom:8px;';
      link.addEventListener('input', () => { livePortfolio.clientHighlights[idx].link = link.value.trim(); renderPreview(); });

      const reviewText = document.createElement('textarea');
      reviewText.rows = 3; reviewText.placeholder = 'Best comment or review text'; reviewText.value = item.reviewText || item.description || '';
      reviewText.style = 'width:100%; margin-bottom:8px;';
      reviewText.addEventListener('input', () => {
        livePortfolio.clientHighlights[idx].reviewText = reviewText.value.trim();
        livePortfolio.clientHighlights[idx].description = reviewText.value.trim(); // keep existing field for public site
        renderPreview();
      });

      const clientName = document.createElement('input');
      clientName.type = 'text'; clientName.placeholder = 'Comment / client name'; clientName.value = item.clientName || '';
      clientName.style = 'width:100%; margin-bottom:8px;';
      clientName.addEventListener('input', () => { livePortfolio.clientHighlights[idx].clientName = clientName.value.trim(); renderPreview(); });

      const actions = document.createElement('div');
      actions.style = 'display:flex;gap:8px;justify-content:flex-end;';
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn-secondary-admin'; del.textContent = 'Delete';
      del.addEventListener('click', () => { livePortfolio.clientHighlights.splice(idx, 1); renderList(); renderPreview(); });
      actions.appendChild(del);

      card.appendChild(title);
      card.appendChild(platform);
      card.appendChild(link);
      card.appendChild(reviewText);
      card.appendChild(clientName);
      card.appendChild(actions);

      listEl.appendChild(card);
    });
  }

  function renderPreview() {
    if (!previewEl) return;
    previewEl.innerHTML = '';
    livePortfolio.clientHighlights.forEach(h => {
      const row = document.createElement('div');
      row.style = 'padding:6px 8px;border-bottom:1px solid #222;';
      const quote = h.reviewText || h.description || '';
      const by = h.clientName ? ` — ${h.clientName}` : '';
      row.textContent = `${quote}${by}`;
      previewEl.appendChild(row);
    });
  }

  renderList();
  renderPreview();

  if (addBtn && !addBtn._bound) {
    addBtn._bound = true;
    addBtn.addEventListener('click', () => {
      livePortfolio.clientHighlights.push({ title: '', platform: '', link: '', reviewText: '', clientName: '' });
      renderList(); renderPreview();
    });
  }

  if (saveBtn && !saveBtn._bound) {
    saveBtn._bound = true;
    saveBtn.addEventListener('click', async () => {
      try {
        const clone = { ...livePortfolio };
        applyVirtualFieldsFromForm(clone);
        await api('/api/portfolio', { method: 'PUT', json: clone });
        alert('Reviews saved.');
      } catch {
        alert('Failed to save reviews. Please log in first.');
      }
    });
  }
}

})(); // Close the IIFE
    

