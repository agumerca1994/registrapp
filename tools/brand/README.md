# Marca tood

Fuentes de la identidad de tood (hasta el 2026-10-30 se llamó tero; la exploración y los mocks son de esa etapa y todavía dicen tero y tienen piquito). Las piezas que usa la app salen de acá; no se editan a mano.

| Qué | Dónde |
|---|---|
| Logo e ícono finales (SVG, PNG 512/192/180) | `frontend/public/brand/tood/` |
| Trazos del logo y de la t, para los componentes | `frontend/lib/brand/tood-marca.ts` |
| Componentes | `frontend/components/brand/ToodLogo.tsx`, `ToodLogoAnimado.tsx`, `ToodAvatar.tsx` |
| Script que genera todo lo anterior | `build.py` |
| Exploración (cara mínima, gestos del logo, avatar) | `exploracion/tero-marca.html` |
| Lienzo: logo, cada animación y el avatar con selectores de ojos y boca | `lienzo/` (`python3 tools/brand/lienzo/build.py`) |
| Mocks del celular y la web, y el video de 34 s | `mocks/` |

## Regenerar las piezas

```bash
python3 -m venv /tmp/brandenv && /tmp/brandenv/bin/pip install fonttools==4.53.1
curl -sL -o /tmp/Fredoka.ttf "https://github.com/google/fonts/raw/main/ofl/fredoka/Fredoka%5Bwdth,wght%5D.ttf"
/tmp/brandenv/bin/python tools/brand/build.py /tmp/Fredoka.ttf /tmp/tood-out
cp /tmp/tood-out/*.svg frontend/public/brand/tood/ && cp /tmp/tood-out/tood-marca.ts frontend/lib/brand/
```

Los PNG del ícono se sacan del SVG cuadrado con Chrome headless (`--screenshot` a 512, 192 y 180), a través de un HTML con `<img width height>`: el SVG mide 1024 y capturado directo sale sólo la esquina.

## Ver los mocks

```bash
python3 tools/brand/mocks/build.py .   # escribe tools/brand/mocks/tero-mocks.html (no se commitea)
```

El video se grabó con el screencast de chrome-devtools sobre una versión de la página que muestra sólo el celular,
y se recortó y comprimió con ffmpeg (`-ss 4.6 -t 34 -vf scale=720:-2,fps=30 -crf 26`).
