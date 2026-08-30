# Bundled fonts

Both are subset to Latin and Latin Extended and keep their variable weight axis, which is why
they are a fraction of the size of the originals (Literata 955 KB -> 185 KB, JetBrains Mono
187 KB -> 65 KB). Text outside that range still renders: Compose falls back to the system fonts
for any glyph these do not carry.

| File | Family | Used for | Licence |
|---|---|---|---|
| `literata.ttf` | Literata (opsz pinned to 16) | people's names | SIL OFL 1.1 |
| `jetbrains_mono.ttf` | JetBrains Mono | dates, years, counts | SIL OFL 1.1 |

Licence texts are shipped in `assets/licenses/` and shown in the app's About screen.

Regenerate with:

```bash
fonttools varLib.instancer Literata[opsz,wght].ttf opsz=16 -o literata_opsz.ttf
pyftsubset literata_opsz.ttf --output-file=literata.ttf --unicodes="$LATIN" \
  --layout-features='kern,liga,calt,onum,lnum,tnum,ccmp,mark,mkmk' --name-IDs='*'
```
