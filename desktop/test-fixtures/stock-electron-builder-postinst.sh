#!/bin/bash
# FIXTURE, not run. The postinst electron-builder generated for f-tree 0.3.2, taken verbatim
# from /var/lib/dpkg/info on a machine where the app core-dumped at launch. Kept so the
# packaging tests can prove they reject it. See issue #102.

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/f-tree-desktop' -a -e '/usr/bin/f-tree-desktop' -a "`readlink '/usr/bin/f-tree-desktop'`" != '/etc/alternatives/f-tree-desktop' ]; then
        rm -f '/usr/bin/f-tree-desktop'
    fi
    update-alternatives --install '/usr/bin/f-tree-desktop' 'f-tree-desktop' '/opt/f-tree/f-tree-desktop' 100 || ln -sf '/opt/f-tree/f-tree-desktop' '/usr/bin/f-tree-desktop'
else
    ln -sf '/opt/f-tree/f-tree-desktop' '/usr/bin/f-tree-desktop'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/f-tree/chrome-sandbox' || true
else
    chmod 0755 '/opt/f-tree/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
