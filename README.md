# Leroader

Auto-reload tabs on a timer. Dark, touch-friendly, works in Brave and Chrome.

- **On:** the visible tab reloads every 30 s (default). **Off:** nothing runs at all.
- Interval picker from 5 s to 5 h: slider, −/+ buttons and quick chips, no typing.
- **Site rules:** give a site, a path or one exact page its own interval, or set it to never reload. Add a rule from the popup ("This site" / "This page") or by tapping an open tab in settings.
- Choose which tabs reload: visible tab, all tabs, or rule sites only.
- Countdown on the toolbar icon, optional hard reload, and the shortcut `Alt+Shift+R` to toggle.

## Install (Brave)

1. Open `brave://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin Leroader to the toolbar.

## Tests

```sh
node --test tests/shared.test.mjs   # rule matching + formatting
node tests/e2e.mjs                  # real browser, counts actual reloads
BROWSER=brave node tests/e2e.mjs    # same, in installed Brave (throwaway profile)
```

The e2e test needs Playwright (`npm i -D playwright`).
