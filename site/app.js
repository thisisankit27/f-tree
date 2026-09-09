/*
 * f-tree site behaviour.
 *
 * Three jobs: read the real release data from GitHub so the page can never quote a stale
 * version or checksum, count downloads from the same source, and run the one interactive
 * element in the hero chart.
 *
 * Everything here is progressive: the page is complete and correct with JavaScript off,
 * and if the API is unreachable the live bits get out of the way rather than guessing.
 */
(function () {
  'use strict';

  var REPO = 'thisisankit27/f-tree';
  var API = 'https://api.github.com/repos/' + REPO + '/releases';
  var CACHE_KEY = 'ftree.release.v2';
  var CACHE_TTL = 10 * 60 * 1000;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------ release data */

  function summarise(releases) {
    var downloads = 0;
    releases.forEach(function (rel) {
      (rel.assets || []).forEach(function (a) { downloads += a.download_count || 0; });
    });

    // Newest shipped release: the API lists newest first.
    var latest = null;
    for (var i = 0; i < releases.length; i++) {
      if (!releases[i].draft && !releases[i].prerelease) { latest = releases[i]; break; }
    }
    if (!latest) latest = releases[0];
    if (!latest) return null;

    var apk = (latest.assets || []).filter(function (a) {
      return /\.apk$/i.test(a.name);
    })[0];

    return {
      downloads: downloads,
      tag: latest.tag_name,
      published: latest.published_at,
      notesUrl: latest.html_url,
      apk: apk && {
        name: apk.name,
        size: apk.size,
        // GitHub returns this as "sha256:<hex>".
        sha256: (apk.digest || '').replace(/^sha256:/, ''),
        url: apk.browser_download_url
      },
      desktop: desktopFrom(releases)
    };
  }

  /*
   * The newest desktop release.
   *
   * Found by its tag rather than by being newest, because desktop releases are published as
   * pre-releases on purpose - it is what keeps `releases/latest` answering with the newest
   * Android release for the app's own updater. See docs/desktop.md.
   */
  function desktopFrom(releases) {
    var rel = null;
    for (var i = 0; i < releases.length; i++) {
      if (releases[i].draft) continue;
      if (/^desktop-v/.test(releases[i].tag_name || '')) { rel = releases[i]; break; }
    }
    if (!rel) return null;

    var files = {};
    (rel.assets || []).forEach(function (a) {
      var kind = /\.exe$/i.test(a.name) ? 'windows'
        : /\.AppImage$/i.test(a.name) ? 'appimage'
        : /\.deb$/i.test(a.name) ? 'deb'
        : null;
      if (!kind) return;
      files[kind] = {
        kind: kind,
        name: a.name,
        size: a.size,
        sha256: (a.digest || '').replace(/^sha256:/, ''),
        url: a.browser_download_url
      };
    });

    return {
      version: (rel.tag_name || '').replace(/^desktop-v/, ''),
      published: rel.published_at,
      notesUrl: rel.html_url,
      files: files
    };
  }

  function loadRelease() {
    try {
      var hit = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.data);
    } catch (e) { /* storage blocked or corrupt — just fetch */ }

    return fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('GitHub API returned ' + r.status);
        return r.json();
      })
      .then(function (json) {
        var data = summarise(json);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: data }));
        } catch (e) { /* not important enough to fail over */ }
        return data;
      });
  }

  /* ---------------------------------------------------------------- helpers */

  function longDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function megabytes(bytes) {
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function fillSpecs(data) {
    var version = data.tag ? data.tag.replace(/^v/, '') : null;
    document.querySelectorAll('[data-spec="version"]').forEach(function (el) {
      if (version) el.textContent = 'Version ' + version;
    });
    document.querySelectorAll('[data-spec="version-bare"]').forEach(function (el) {
      if (version) el.textContent = version;
    });
    document.querySelectorAll('[data-spec="size"]').forEach(function (el) {
      if (data.apk) el.textContent = megabytes(data.apk.size);
    });
  }

  function countUp(el, target) {
    if (reduceMotion || target > 100000) {
      el.textContent = target.toLocaleString();
      return;
    }
    var started = null;
    var duration = 900;
    function frame(now) {
      if (started === null) started = now;
      var t = Math.min(1, (now - started) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* --------------------------------------------------------- download count */
  /*
   * Kept, but nothing on the page carries #counter at the moment. The total was in the hero
   * and, while it is honestly counted, a small number is the first thing a stranger reads
   * about a sideloaded APK. GitHub keeps counting per release asset regardless of what this
   * page shows, so restoring the counter is a matter of putting the markup back.
   */

  function showCounter(data) {
    var box = document.getElementById('counter');
    var value = document.getElementById('counter-value');
    var label = document.getElementById('counter-label');
    if (!box || !value) return;

    var n = data.downloads;
    box.setAttribute('data-state', 'ready');
    label.textContent = (n === 1 ? 'download' : 'downloads') +
      ' so far · counted by GitHub, not by us';

    var seen = false;
    var reveal = function () {
      if (seen) return;
      seen = true;
      countUp(value, n);
    };

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { reveal(); io.disconnect(); } });
      });
      io.observe(box);
    } else {
      reveal();
    }
  }

  function hideCounter() {
    var box = document.getElementById('counter');
    if (box) box.hidden = true;
  }

  /* ------------------------------------------------------------------ theme */
  /*
   * Light and dark. The head script has already put the stored choice on <html> before the
   * first paint; all this does is flip it and remember it.
   *
   * The absence of data-theme is a state, not a missing value: it means "whatever the system
   * says", which is how the page starts for everyone who has never touched the toggle. So the
   * toggle asks what is actually on screen — matchMedia, not the attribute — and sets the
   * opposite. Choosing the mode you are already in is how you get back to following the system,
   * so picking light on a light system clears the choice rather than pinning it.
   */

  var DARK_GROUND = '#10150f';
  var LIGHT_GROUND = '#f7f6f1';

  function systemPrefersDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function currentTheme() {
    var set = document.documentElement.getAttribute('data-theme');
    if (set === 'dark' || set === 'light') return set;
    return systemPrefersDark() ? 'dark' : 'light';
  }

  /*
   * Both metas carry the same value on purpose. The pair in the markup is media-scoped so that
   * the browser chrome is right with this script switched off; once a choice has been made the
   * matching one has to give the chosen answer, and the quiet way to guarantee that is for both
   * to agree.
   */
  function paintBrowserChrome(theme) {
    var ground = theme === 'dark' ? DARK_GROUND : LIGHT_GROUND;
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
      meta.setAttribute('content', ground);
    });
  }

  function describeToggle(btn, theme) {
    var next = theme === 'dark' ? 'light' : 'dark';
    btn.setAttribute('aria-label', 'Switch to ' + next + ' mode');
    btn.setAttribute('title', 'Switch to ' + next + ' mode');
  }

  function wireTheme() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;

    var system = window.matchMedia('(prefers-color-scheme: dark)');

    var sync = function () {
      var theme = currentTheme();
      describeToggle(btn, theme);
      paintBrowserChrome(theme);
    };

    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      if (next === (system.matches ? 'dark' : 'light')) {
        // Back in step with the system: stop overriding it rather than pinning today's answer.
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.removeItem('ftree.theme'); } catch (e) { /* nothing to remember with */ }
      } else {
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('ftree.theme', next); } catch (e) { /* a convenience, not a requirement */ }
      }
      sync();
    });

    // Only reaches the page while no explicit choice is stored, which is exactly when it should.
    if (system.addEventListener) system.addEventListener('change', sync);
    else if (system.addListener) system.addListener(sync);

    sync();
  }

  /* ------------------------------------------------- the one interactive node */
  /*
   * The hero chart's dashed card is the app's whole argument in one gesture: an unnamed
   * person is already a real entry, and naming her later changes nothing else about the
   * tree. Letting people do it here is quicker than explaining it.
   */

  function wireNamingSlot() {
    var stage = document.getElementById('chart-stage');
    var slot = document.getElementById('slot');
    var name = document.getElementById('slot-name');
    var action = document.getElementById('chart-action');
    var caption = document.getElementById('chart-caption-text');
    if (!stage || !slot || !name || !action || !caption) return;

    var card = slot.querySelector('.node-card');
    var editing = false;

    function setCaption(html) { caption.innerHTML = html; }

    function named(value) {
      name.textContent = value;
      slot.classList.remove('node-unknown');
      slot.classList.add('node-named');
      slot.setAttribute('aria-label', value + '. Shyam Lal’s wife.');
      setCaption('Recorded. She was always a real person in this tree — ' +
        'the only thing that changed is that the card now has a name on it.' +
        '<button type="button" id="chart-action">Put it back</button>');
      rewire();
    }

    function cleared() {
      name.textContent = 'Unknown';
      slot.classList.remove('node-named');
      slot.classList.add('node-unknown');
      slot.setAttribute('aria-label',
        'Unknown. Shyam Lal’s wife. Activate to give her a name.');
      setCaption('Shyam Lal’s wife is in this tree. Her name isn’t.' +
        '<button type="button" id="chart-action">Give her a name</button>');
      rewire();
    }

    function edit() {
      if (editing) return;
      editing = true;

      var box = card.getBoundingClientRect();
      var frame = stage.getBoundingClientRect();
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'name-input';
      input.maxLength = 24;
      input.placeholder = 'Her name';
      input.setAttribute('aria-label', 'Name for Shyam Lal’s wife');
      input.style.left = (box.left - frame.left) + 'px';
      input.style.top = (box.top - frame.top) + 'px';
      input.style.width = box.width + 'px';
      input.style.height = box.height + 'px';
      if (slot.classList.contains('node-named')) input.value = name.textContent;

      function finish(commit) {
        if (!editing) return;
        editing = false;
        var value = input.value.trim();
        input.remove();
        if (commit && value) named(value); else if (commit) cleared();
        slot.focus();
      }

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', function () { finish(true); });

      stage.appendChild(input);
      input.focus();
      input.select();
    }

    function rewire() {
      var btn = document.getElementById('chart-action');
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (slot.classList.contains('node-named')) cleared(); else edit();
      });
    }

    slot.addEventListener('click', edit);
    slot.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); }
    });
    rewire();
  }

  /* --------------------------------------------------------------- the demo */
  /*
   * The demo video ships with native `controls` so that it is playable with this script
   * switched off. Where the script does run we take them away and put one play button in
   * front of the poster instead, because the native bar is a black slab that sits over the
   * bottom of a bone-coloured poster and hides the rows it exists to show. The controls come
   * back as soon as the video is actually playing, which is when somebody wants a scrubber.
   */

  function wireDemo() {
    var stage = document.getElementById('demo-stage');
    var video = document.getElementById('demo');
    if (!stage || !video) return;

    video.controls = false;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'demo-play';
    btn.setAttribute('aria-label', 'Play the demo — 17 seconds, no sound');
    btn.innerHTML =
      '<span class="disc" aria-hidden="true">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>' +
      '</span>';

    btn.addEventListener('click', function () {
      video.controls = true;
      btn.remove();
      var started = video.play();
      // Older Safari returns nothing here; a rejection only means the poster stays put.
      if (started && started.catch) started.catch(function () { video.controls = true; });
    });

    stage.appendChild(btn);
  }

  /* ------------------------------------------------------------------ thanks */

  function wireThanks(data) {
    var link = document.getElementById('apk-link');
    var status = document.getElementById('dl-status');
    if (!link) return;

    if (!data || !data.apk) {
      if (status) {
        status.textContent =
          'Could not reach GitHub just now. The releases page has every build.';
      }
      link.textContent = 'Open the releases page';
      link.href = 'https://github.com/' + REPO + '/releases/latest';
      return;
    }

    link.href = data.apk.url;
    link.setAttribute('download', data.apk.name);
    link.textContent = 'Download ' + data.apk.name;

    var el;
    if ((el = document.getElementById('fact-file'))) el.textContent = data.apk.name;
    if ((el = document.getElementById('fact-size'))) el.textContent = megabytes(data.apk.size);
    if ((el = document.getElementById('fact-sha'))) {
      el.textContent = data.apk.sha256 || 'published on the release page';
    }
    if ((el = document.getElementById('fact-notes'))) el.href = data.notesUrl;
    if ((el = document.getElementById('fact-date')) && data.published) {
      el.textContent = longDate(data.published);
    }

    // Start the download without navigating away from the instructions.
    var frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = data.apk.url;
    document.body.appendChild(frame);
    if (status) status.textContent = 'Your download has started.';
  }

  /* ------------------------------------------------------ the desktop page */

  /*
   * Which file this reader wants.
   *
   * A guess, and treated as one: it picks the primary button and nothing else, with the other two
   * kept one click away rather than hidden. `userAgentData` where it exists, the platform string
   * where it does not, and no pretence of certainty either way.
   */
  function guessPlatform() {
    // `?platform=windows` overrides the guess. It is how somebody on one machine gets the file for
    // another - "send me the Windows link" - and it is what makes the routing testable in a real
    // browser rather than only by reading it.
    var forced = (location.search.match(/[?&]platform=([a-z]+)/i) || [])[1];
    if (forced) return forced.toLowerCase();

    var hint = (navigator.userAgentData && navigator.userAgentData.platform)
      || navigator.platform || '';
    var ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (/win/i.test(hint) || /windows/i.test(ua)) return 'windows';
    if (/linux/i.test(hint) || /linux|x11|ubuntu/i.test(ua)) return 'linux';
    if (/mac/i.test(hint) || /mac os/i.test(ua)) return 'mac';
    return 'unknown';
  }

  var KIND_LABEL = {
    windows: 'the Windows installer',
    deb: 'the .deb for Ubuntu and Debian',
    appimage: 'the AppImage'
  };

  function wireDesktop(desktop) {
    var button = document.getElementById('desktop-primary');
    var label = document.getElementById('desktop-primary-label');
    var status = document.getElementById('desktop-status');
    var others = document.getElementById('desktop-others');
    if (!button) return;

    if (!desktop || !Object.keys(desktop.files).length) {
      status.textContent = 'Could not reach GitHub just now. The releases page has every build.';
      label.textContent = 'Open the releases page';
      return;
    }

    var platform = guessPlatform();

    // A phone cannot run any of these, and saying so is more use than offering an 80MB installer.
    if (platform === 'android' || platform === 'ios') {
      label.textContent = 'Get f-tree for Android';
      button.href = platform === 'android' ? '../thanks/' : '../';
      status.textContent = 'This page is for a laptop. On a phone, f-tree is an Android app.';
      others.innerHTML = '';
      return;
    }

    var order = platform === 'windows' ? ['windows', 'deb', 'appimage'] : ['deb', 'appimage', 'windows'];
    var first = null;
    order.forEach(function (kind) { if (!first && desktop.files[kind]) first = desktop.files[kind]; });
    if (!first) return;

    button.href = first.url;
    button.setAttribute('download', first.name);
    label.textContent = 'Download ' + KIND_LABEL[first.kind];
    status.textContent = first.name + ' · ' + megabytes(first.size) + ' · version ' + desktop.version;

    // Mac is not built yet, and pretending otherwise would waste somebody's afternoon.
    if (platform === 'mac') {
      status.textContent = 'There is no macOS build yet. These are the Windows and Linux files.';
    }

    var rest = order.slice(1).filter(function (k) { return desktop.files[k]; });
    others.innerHTML = rest.length
      ? 'On another system? ' + rest.map(function (kind) {
        var f = desktop.files[kind];
        return '<a href="' + f.url + '" download="' + f.name + '">' + KIND_LABEL[kind]
          + '</a> (' + megabytes(f.size) + ')';
      }).join(' &middot; ')
      : '';

    fillDesktopFacts(desktop);
  }

  function fillDesktopFacts(desktop) {
    var version = document.getElementById('dfact-version');
    var date = document.getElementById('dfact-date');
    var notes = document.getElementById('dfact-notes');
    var hashes = document.getElementById('desktop-hashes');
    if (version) version.textContent = desktop.version;
    if (date && desktop.published) date.textContent = longDate(desktop.published);
    if (notes && desktop.notesUrl) notes.href = desktop.notesUrl;
    if (!hashes) return;

    var rows = ['windows', 'deb', 'appimage'].filter(function (k) { return desktop.files[k]; });
    hashes.innerHTML = rows.map(function (kind) {
      var f = desktop.files[kind];
      return '<div class="hash-row"><p class="hash-name">' + f.name + '</p>'
        + '<p class="hash">' + (f.sha256 || 'published on the release page') + '</p></div>';
    }).join('');
  }

  /* -------------------------------------------------------------------- init */

  var onDesktop = !!document.getElementById('desktop-downloads');
  var onThanks = !!document.getElementById('apk-link');

  wireTheme();
  wireNamingSlot();
  wireDemo();

  loadRelease().then(function (data) {
    if (!data) throw new Error('no releases published');
    fillSpecs(data);
    if (onDesktop) wireDesktop(data.desktop);
    else if (onThanks) wireThanks(data);
    else showCounter(data);
  }).catch(function (err) {
    if (window.console) console.warn('f-tree: release data unavailable —', err.message);
    if (onDesktop) wireDesktop(null);
    else if (onThanks) wireThanks(null);
    else hideCounter();
  });
})();
