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
   * The newest *stable* desktop release.
   *
   * Found by its tag rather than by being newest, because desktop releases are published as
   * pre-releases on purpose - it is what keeps `releases/latest` answering with the newest
   * Android release for the app's own updater. See docs/desktop.md.
   *
   * And only a tag with no suffix. GitHub's pre-release flag cannot say "beta" for the desktop -
   * every desktop release carries it - so the suffix does: `desktop-v0.6.0-beta.1` is a beta, as the
   * desktop's own updater reads it (desktop/update.js). Matching any `desktop-v` tag would hand a
   * beta to everybody who clicks Download, which is a stable release in all but name.
   */
  var STABLE_DESKTOP = /^desktop-v\d+(\.\d+)*$/;

  function desktopFrom(releases) {
    var rel = null;
    for (var i = 0; i < releases.length; i++) {
      if (releases[i].draft) continue;
      if (STABLE_DESKTOP.test(releases[i].tag_name || '')) { rel = releases[i]; break; }
    }
    if (!rel) return null;

    // Handed on as a flat list: which files a release has is the pages' business, not this
    // function's, and naming them here meant adding a branch every time a target was added.
    var assets = (rel.assets || [])
      .filter(function (a) { return /^https:/.test(a.browser_download_url || ''); })
      .map(function (a) {
        return {
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
      assets: assets
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

  /* ------------------------------------------------------ the desktop pages */

  /*
   * Which file this reader most likely wants.
   *
   * A guess, and treated as one: it puts a "your system" mark on a card and moves that card first.
   * It never hides the other one. `?platform=` overrides it, which is how somebody gets the file
   * for a different machine and how the routing is testable in a browser rather than by reading it.
   */
  function guessPlatform() {
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

  /* Each file, as the download page and the thank-you page both need to talk about it. */
  var FILES = {
    win: { os: 'windows', what: 'Installer', kind: '.exe', match: /\.exe$/i },
    deb: { os: 'linux', what: 'Debian / Ubuntu', kind: '.deb', match: /\.deb$/i },
    tar: { os: 'linux', what: 'Portable folder', kind: '.tar.gz', match: /\.tar\.gz$/i },
    app: { os: 'linux', what: 'AppImage', kind: '.AppImage', match: /\.AppImage$/i }
  };
  var ORDER = { windows: ['win'], linux: ['deb', 'tar', 'app'] };

  function filesFrom(desktop) {
    var found = {};
    Object.keys(FILES).forEach(function (id) {
      var f = (desktop.assets || []).filter(function (a) { return FILES[id].match.test(a.name); })[0];
      if (f) found[id] = f;
    });
    return found;
  }

  function fileRow(id, asset, recommended) {
    var spec = FILES[id];
    return '<a class="file' + (recommended ? ' primary' : '') + '" href="thanks/?f=' + id + '">'
      + '<span class="what">' + spec.what + '</span>'
      + '<span class="meta">' + spec.kind + '  ·  ' + megabytes(asset.size) + '</span></a>';
  }

  function wireDownloads(desktop) {
    var assurance = document.getElementById('assurance');
    if (!document.getElementById('platforms')) return;

    if (!desktop || !(desktop.assets || []).length) {
      assurance.innerHTML = 'Could not reach GitHub just now. '
        + '<a href="https://github.com/thisisankit27/f-tree/releases?q=desktop&expanded=true">'
        + 'The releases page has every build.</a>';
      return;
    }

    var files = filesFrom(desktop);
    var platform = guessPlatform();

    ['windows', 'linux'].forEach(function (os) {
      var ids = ORDER[os].filter(function (id) { return files[id]; });
      var into = document.getElementById('files-' + os);
      if (!into) return;
      into.innerHTML = ids.map(function (id, i) {
        return fileRow(id, files[id], platform === os && i === 0);
      }).join('')
        // Said once, under the row it is about, rather than crammed into a size column.
        + (files.app && os === 'linux'
          ? '<p class="caution">On Ubuntu 24.04 and newer an AppImage needs one extra flag to '
            + 'start. The steps say which; the other two files need nothing.</p>'
          : '');
      if (platform === os) {
        document.getElementById('card-' + os).classList.add('is-yours');
        document.getElementById('tag-' + os).hidden = false;
      }
    });

    assurance.textContent = 'Version ' + desktop.version + ' · released '
      + (desktop.published ? longDate(desktop.published) : 'recently')
      + ' · built in the open by GitHub Actions, with a checksum for every file.';

    if (platform === 'android' || platform === 'ios') {
      assurance.innerHTML = 'This page is for a laptop. On a phone, '
        + '<a href="../thanks/">f-tree is an Android app</a>.';
    } else if (platform === 'mac') {
      assurance.textContent = 'There is no macOS build yet — these are the Windows and Linux files.';
    }
  }

  /* ------------------------------------------------ the thank-you page */

  function copyable(command) {
    return '<span class="copyline"><code>' + command + '</code>'
      + '<button type="button" class="copy" data-copy="' + command.replace(/"/g, '&quot;')
      + '">Copy</button></span>';
  }

  /* The steps for the one file this reader actually took, and no others. */
  function stepsFor(id, name) {
    if (id === 'win') return {
      title: 'Installing on Windows',
      lede: 'Two clicks past a warning, then it is an ordinary app.',
      steps: [
        ['Windows will stop it', 'The installer is not code-signed, so Defender treats it as an '
          + 'unrecognised app and the publisher reads <b>Unknown</b>. Choose <b>More info</b>, then '
          + '<b>Run anyway</b>. That is the whole of it — there is nothing else unusual about the file.'],
        ['Choose where it goes', 'It installs for your account only, so it never asks for an '
          + 'administrator password and writes nothing outside that folder and your own app data.'],
        ['Start a tree, or open one', 'Choose <b>Start a new tree</b> and add people, or open a '
          + '<code>.ftree</code> you already have with <b>File → Open tree</b> — including one '
          + 'exported from the Android app under <b>Settings → Export your tree</b>. It reopens the '
          + 'last file by itself next time.']
      ]
    };
    if (id === 'deb') return {
      title: 'Installing on Ubuntu or Debian',
      lede: 'One command, then it is in your applications menu.',
      steps: [
        ['Open a terminal where you downloaded it', 'Usually <code>~/Downloads</code>.'],
        ['Install it', 'The leading <code>./</code> matters — without it apt goes looking for a '
          + 'package by that name instead of your file.<br>' + copyable('sudo apt install ./' + name)],
        ['Launch it', 'From the applications menu, or run <code>/opt/f-tree/f-tree-desktop</code>. '
          + 'Then choose <b>Start a new tree</b>, or open a <code>.ftree</code> you already have.']
      ]
    };
    if (id === 'tar') {
      var folder = name.replace(/\.tar\.gz$/, '');
      return {
        title: 'Running the portable folder',
        lede: 'Nothing is installed — but on current Ubuntu it needs one command first.',
        steps: [
          ['Unpack it', copyable('tar -xzf ' + name)],
          ['On Ubuntu 24.04 and newer, do this once', 'Those releases stop an ordinary program '
            + 'from using the sandbox Chromium prefers, so it falls back to a helper that has to '
            + 'be owned by root. A tar archive cannot carry that, so the app exits the moment you '
            + 'start it, complaining about <code>chrome-sandbox</code>. This is the fix, and it '
            + 'keeps the sandbox switched on:<br>'
            + copyable('sudo chown root:root ' + folder + '/chrome-sandbox && sudo chmod 4755 '
              + folder + '/chrome-sandbox')],
          ['Run it', 'Straight out of the folder it unpacked into.<br>'
            + copyable('./' + folder + '/f-tree-desktop')],
          ['Start a tree, or open one', 'Choose <b>Start a new tree</b>, or open a '
            + '<code>.ftree</code> you already have with <b>File → Open tree</b>.']
        ],
        caution: '<strong>If you would rather not type any of that,</strong> the '
          + '<a href="../">.deb</a> does the same thing for you and needs no follow-up.'
      };
    }
    return {
      title: 'Running the AppImage',
      lede: 'One file, no install — and the format that struggles most on current Ubuntu.',
      steps: [
        ['Make it executable', copyable('chmod +x ' + name)],
        ['Run it', copyable('./' + name)],
        ['If nothing happens, run it this way instead', 'On <b>Ubuntu 24.04 and newer</b> an '
          + 'AppImage will not mount: those releases replaced the FUSE 2 helper it needs with '
          + '<code>fusermount3</code>. Installing <code>libfuse2</code> does not fix it. This does, '
          + 'by unpacking to a temporary folder instead:<br>'
          + copyable('./' + name + ' --appimage-extract-and-run')]
      ],
      caution: '<strong>On Ubuntu 24.04 and newer this format is a poor bet.</strong> Even once '
        + 'it mounts, it unpacks somewhere temporary, and the sandbox helper Chromium falls back '
        + 'to on those releases has to be owned by root — which nothing unpacked to a temporary '
        + 'folder can be. Take the <a href="../">.deb</a> instead; it is the Linux build that '
        + 'needs nothing from you.'
    };
  }

  function wireThanksDesktop(desktop) {
    var nameEl = document.getElementById('dl-name');
    if (!nameEl) return;

    var id = (location.search.match(/[?&]f=([a-z]+)/i) || [])[1] || 'win';
    if (!FILES[id]) id = 'win';

    if (!desktop) {
      document.getElementById('dl-eyebrow').textContent = 'Download';
      document.getElementById('dl-lede').textContent =
        'Could not reach GitHub just now — the releases page has every build.';
      return;
    }

    var files = filesFrom(desktop);
    var asset = files[id];
    if (!asset) {
      document.getElementById('dl-lede').textContent =
        'That file is not in the latest release. The releases page has every build.';
      return;
    }

    nameEl.textContent = asset.name;
    document.getElementById('dl-meta').textContent =
      megabytes(asset.size) + '  ·  version ' + desktop.version;
    var fallback = document.getElementById('dl-fallback');
    fallback.href = asset.url;
    fallback.setAttribute('download', asset.name);
    document.getElementById('dl-sha').textContent = asset.sha256 || 'published with the release';

    var verify = document.getElementById('verify-command');
    if (verify) {
      verify.innerHTML = copyable(id === 'win'
        ? 'certutil -hashfile ' + asset.name + ' SHA256'
        : 'sha256sum ' + asset.name);
    }

    var plan = stepsFor(id, asset.name);
    document.getElementById('steps-title').textContent = plan.title;
    document.getElementById('steps-lede').textContent = plan.lede;
    document.getElementById('steps').innerHTML = plan.steps.map(function (step) {
      return '<li><h3>' + step[0] + '</h3><p>' + step[1] + '</p></li>';
    }).join('');
    if (plan.caution) {
      var caution = document.getElementById('steps-caution');
      caution.innerHTML = plan.caution;
      caution.hidden = false;
    }

    wireCopyButtons();

    // Start it without navigating away from the instructions.
    var frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = asset.url;
    document.body.appendChild(frame);
  }

  function wireCopyButtons() {
    document.querySelectorAll('button.copy').forEach(function (button) {
      button.addEventListener('click', function () {
        var text = button.dataset.copy;
        var done = function () {
          button.textContent = 'Copied';
          setTimeout(function () { button.textContent = 'Copy'; }, 1600);
        };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
        else done();
      });
    });
  }

  /* -------------------------------------------------------------------- init */

  var onDownloads = !!document.getElementById('platforms');
  var onDesktopThanks = !!document.getElementById('dl-name');
  var onThanks = !!document.getElementById('apk-link');

  wireTheme();
  wireNamingSlot();
  wireDemo();

  loadRelease().then(function (data) {
    if (!data) throw new Error('no releases published');
    fillSpecs(data);
    if (onDesktopThanks) wireThanksDesktop(data.desktop);
    else if (onDownloads) wireDownloads(data.desktop);
    else if (onThanks) wireThanks(data);
    else showCounter(data);
  }).catch(function (err) {
    if (window.console) console.warn('f-tree: release data unavailable —', err.message);
    if (onDesktopThanks) wireThanksDesktop(null);
    else if (onDownloads) wireDownloads(null);
    else if (onThanks) wireThanks(null);
    else hideCounter();
  });
})();
