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
  var CACHE_KEY = 'ftree.release.v1';
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
      }
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
      el.textContent = new Date(data.published).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    }

    // Start the download without navigating away from the instructions.
    var frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = data.apk.url;
    document.body.appendChild(frame);
    if (status) status.textContent = 'Your download has started.';
  }

  /* -------------------------------------------------------------------- init */

  var onThanks = !!document.getElementById('apk-link');

  wireNamingSlot();

  loadRelease().then(function (data) {
    if (!data) throw new Error('no releases published');
    fillSpecs(data);
    if (onThanks) wireThanks(data); else showCounter(data);
  }).catch(function (err) {
    if (window.console) console.warn('f-tree: release data unavailable —', err.message);
    if (onThanks) wireThanks(null); else hideCounter();
  });
})();
