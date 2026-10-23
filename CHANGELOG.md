# Changelog

All notable changes to Drawzy are documented here. This project follows [Semantic Versioning](https://semver.org).

## [1.2.0] — 2026-10-24

### Added

- **Linux support.** An `.rpm` for Fedora and RHEL-based distros, a `.deb` for Ubuntu and Debian, and an `.AppImage` for everything else.
- On GNOME, including Wayland, Drawzy adds `Ctrl` + `Shift` + `D` and `Ctrl` + `Shift` + `H` to the system's custom keyboard shortcuts on first launch. Pressing the shortcut also starts Drawzy if it isn't running.
- `drawzy --toggle` and `drawzy --toggle-visible`, for binding the shortcuts yourself on KDE Plasma, Sway, Hyprland and other Wayland desktops.
- **Quit Drawzy** in the ☰ menu and command palette, and **Open at login** in Preferences, for desktops without a tray.

### Changed

- Every build is now launch-tested on Windows, macOS, Ubuntu (installed `.deb`) and Fedora (installed `.rpm`).

### Fixed

- Opening Drawzy while it was already running briefly started a second copy before handing over.

## [1.1.0] — 2026-10-22

### Added

- **macOS support.** A universal `.dmg` for Apple Silicon and Intel Macs (macOS 13 Ventura or later). Drawzy lives in the menu bar, works over full-screen apps and on every desktop, and uses `⌘` + `Shift` + `D`.
- Shortcut labels in menus, the command palette and help show Mac keys (`Cmd`, `Option`) on macOS.
- `npm test` and a `--self-test` flag that launch the real overlay and check the drawing engine loads. CI runs it on every build.

### Changed

- Every push is now built and launch-tested on Windows and macOS.

## [1.0.0] — 2026-10-22

The first public release.

### Added

- Transparent always-on-top overlay for your main display, toggled with `Ctrl` + `Shift` + `D`.
- Excalidraw-style tools: pen, rectangle, diamond, ellipse, arrow, line, text, sticky note, eraser, laser pointer and images.
- Style panel with stroke and background colours, fill style, stroke width and style, sloppiness, font size and opacity.
- Selection with move, resize handles, multi-select, duplicate, copy/cut/paste and layer ordering.
- Zoom and pan, with a one-click "Reset view to match screen".
- Light and dark themes, or follow Windows.
- Open and save `.excalidraw` files, and paste from excalidraw.com.
- Export to PNG, copy as PNG, and screenshot the screen with your drawings.
- Command palette, Find on canvas and a keyboard shortcut reference.
- Choice of keeping drawings on screen or hiding them when you stop drawing; drawings are remembered after quitting.
- System tray menu with "Start with Windows".
- One-click Windows installer and a portable `.exe`.

[1.2.0]: https://github.com/Aayush-shrma/drawzy/releases/tag/v1.2.0
[1.1.0]: https://github.com/Aayush-shrma/drawzy/releases/tag/v1.1.0
[1.0.0]: https://github.com/Aayush-shrma/drawzy/releases/tag/v1.0.0
