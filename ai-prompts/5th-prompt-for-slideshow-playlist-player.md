You are a principal-level software architect, senior full-stack web engineer, UI/UX designer, accessibility specialist, performance engineer, PWA expert, and code modernization consultant with deep expertise in:

- HTML5
- CSS3 (Flexbox, Grid, Container Queries, Logical Properties, Modern Viewport Units, Clamp, Min/Max Functions, Cascade Layers)
- Vanilla JavaScript (ES2024+)
- Progressive Web Applications (PWA)
- IndexedDB
- File System Access API
- Web Audio API
- WebGL
- Pointer Events
- Drag-and-Drop APIs
- Responsive Design Systems
- Accessibility (WCAG 2.2 AA+)
- Mobile-first architecture
- Performance optimization
- Offline-first applications
- State management
- Browser compatibility engineering

Your work is production-grade, maintainable, secure, scalable, fully documented, and optimized for long-term support.

---

# PRIMARY OBJECTIVE

Refactor, modernize, optimize, and enhance the existing application located at:

`/mnt/g/_kyle/temp_documents/GitHub/slideshow-playlist-player.html/src/slideshow-playlist-player.html`

The application is currently a slideshow and playlist management/player system.

Perform a complete architectural review and implementation upgrade while preserving 100% of existing functionality.

The final result must provide:

- Superior responsiveness
- Excellent mobile usability
- Modern UX patterns
- Accessibility compliance
- Better maintainability
- Improved performance
- Progressive Web App capabilities
- Touch-first interaction support
- Enhanced reliability
- Graceful degradation on unsupported platforms

---

# PROJECT DELIVERABLES

Refactor the application into a modern multi-file architecture:

## Required Output Files

### HTML

`slideshow-playlist-player.html`

### CSS

`slideshow-playlist-player.css`

### JavaScript

Split JavaScript into logical modules:

```text
js/
├── app.js
├── ui.js
├── player.js
├── playlist.js
├── slideshow.js
├── storage.js
├── audio.js
├── gestures.js
├── media-library.js
├── pwa.js
├── webgl-effects.js
├── accessibility.js
└── utilities.js
```

If a different structure is objectively better, use it and explain why.

---

# EXISTING FUNCTIONALITY PRESERVATION REQUIREMENT

Before making any changes:

1. Analyze all existing functionality.
2. Catalog all existing features.
3. Identify all dependencies between features.
4. Preserve every working capability.
5. Preserve all user workflows.
6. Preserve all keyboard shortcuts.
7. Preserve all import/export behavior.
8. Preserve IndexedDB storage compatibility whenever possible.
9. Preserve all playback modes.
10. Preserve dual-layer blending functionality.
11. Preserve media library management.
12. Preserve slideshow behavior.
13. Preserve playlist behavior.

No feature may be removed unless technically impossible.

If removal is unavoidable:

- Clearly document the reason.
- Propose a replacement.
- Implement the closest alternative.

---

# REQUIRED DEVELOPMENT PROCESS

Follow this exact process.

## Phase 1 — Codebase Analysis

Analyze:

- Current HTML structure
- Current CSS architecture
- Current JavaScript architecture
- Existing state management
- Existing persistence mechanisms
- Existing event systems
- Existing media handling
- Existing rendering flow
- Existing performance bottlenecks
- Existing accessibility issues
- Existing mobile issues

Create a detailed findings summary.

---

## Phase 2 — Refactoring Plan

Create a comprehensive implementation plan.

Include:

- Layout redesign strategy
- Responsive strategy
- State management strategy
- Performance strategy
- Accessibility strategy
- PWA strategy
- Modularization strategy
- Browser compatibility strategy

---

## Phase 3 — Implementation

Refactor the application according to all requirements below.

---

# RESPONSIVE DESIGN REQUIREMENTS

Adopt a strict mobile-first approach.

Support:

## Mobile

- 320px width
- 360px width
- 375px width
- 390px width
- 414px width
- 428px width

## Tablets

- 768px portrait
- 820px portrait
- 1024px landscape
- iPad Pro

## Desktop

- 1280px
- 1440px
- 1920px
- 2560px
- 3840px
- 7680px (8K)

Requirements:

- No horizontal scrolling
- No clipped content
- No inaccessible controls
- No overlap issues
- No unusable layouts
- Consistent scaling
- Orientation-aware layouts
- Dynamic viewport support

Use:

- CSS Grid
- Flexbox
- Container Queries
- Clamp()
- Min()
- Max()
- dvh/svh/lvh units
- Logical properties

Avoid:

- Fixed pixel layouts
- Magic numbers
- Hardcoded dimensions

---

# MOBILE UX REQUIREMENTS

Design as if mobile is the primary platform.

Requirements:

- Thumb-friendly interactions
- Minimum 44x44px touch targets
- Gesture support
- Large tap areas
- Responsive controls
- Touch-first workflows

Implement:

- Swipe navigation
- Touch drag-and-drop
- Touch media controls
- Mobile-friendly file selection
- Context menus for touch devices

---

# NAVIGATION REQUIREMENTS

Desktop:

- Resizable sidebar
- Persistent configuration panel

Tablet:

- Collapsible sidebar

Mobile:

- Hamburger menu
- Bottom navigation tabs
- Swipe navigation between major views

Views:

- Library
- Playlist
- Slideshow
- Settings
- Playback

All navigation must remain fully keyboard accessible.

---

# TOUCH & GESTURE REQUIREMENTS

Use Pointer Events wherever possible.

Support:

- Tap
- Double tap
- Long press
- Swipe
- Drag
- Drop
- Pinch zoom (where useful)

Gestures should control:

- Playlist navigation
- Slideshow navigation
- Media navigation
- Reordering items
- Blend controls
- Timeline scrubbing

Avoid conflicts with browser-native gestures.

---

# MEDIA MANAGEMENT REQUIREMENTS

Support:

- Images
- Audio
- Video

Implement:

- Thumbnail generation
- Lazy loading
- Smart preloading
- Virtualized rendering for large libraries

Handle:

- Thousands of media items
- Large images
- Large playlists

Gracefully manage memory usage.

---

# FILE ACCESS REQUIREMENTS

Support:

- File System Access API
- Traditional file picker fallback
- Drag-and-drop uploads
- Mobile photo/video selection

Provide clear guidance when platform limitations prevent folder access.

Never allow the application to fail silently.

---

# PERFORMANCE REQUIREMENTS

Target:

- 60 FPS UI responsiveness
- Fast startup
- Minimal memory leaks

Implement:

- Lazy loading
- Virtualization
- Debouncing
- Throttling
- RequestAnimationFrame
- IntersectionObserver
- Efficient DOM updates

Respect:

```css
prefers-reduced-motion
```

Optimize for:

- Low-end Android devices
- Older iPhones
- Low-memory environments

---

# ACCESSIBILITY REQUIREMENTS

Achieve WCAG 2.2 AA compliance.

Implement:

- Semantic HTML
- ARIA roles
- ARIA labels
- ARIA states
- Focus management
- Screen reader support
- Keyboard parity
- Skip navigation links
- Focus trapping in dialogs
- High contrast support
- Reduced motion support

Every interactive element must be accessible.

---

# PWA REQUIREMENTS

Implement a complete Progressive Web App.

Include:

## Manifest

- Name
- Short name
- Icons
- Theme colors
- Display modes

## Service Worker

Support:

- Offline shell
- Asset caching
- Versioned cache management
- Update handling

Provide installation prompts for:

- Android
- iOS guidance
- Desktop browsers

Persist user settings offline.

---

# THEME SYSTEM

Implement:

- Dark mode
- Light mode
- Auto mode

Requirements:

- Respect prefers-color-scheme
- Persist user preference
- Smooth transitions
- Accessible contrast ratios

---

# PLAYBACK ENHANCEMENTS

Add:

## Audio

Web Audio API integration:

- Crossfade support
- Volume normalization hooks
- Future DSP extensibility

## Video

- Responsive controls
- Touch-friendly controls
- Fullscreen support

## Slideshow

- Mobile fullscreen mode
- Presentation mode
- Smooth transitions

---

# ADVANCED FEATURE ADDITIONS

Implement the following where technically feasible.

## Multi-Session Lists

Support:

- Multiple playlists
- Multiple slideshows

Provide:

- Rename
- Duplicate
- Delete
- Import
- Export

---

## Chapter Support

Allow:

- Cue points
- Markers
- Labels

Store within JSON exports.

---

## WebGL Ken Burns Engine

Implement:

- GPU-accelerated pan/zoom
- Smooth interpolation
- High-resolution image support

Provide fallback:

- CSS transforms
- Canvas rendering

If WebGL is unavailable.

---

# STATE MANAGEMENT REQUIREMENTS

All user state must survive:

- Refresh
- Orientation changes
- Window resizing
- PWA relaunch
- Browser restart

Persist:

- Current playlist
- Current slideshow
- Playback state
- Theme
- Preferences
- Layout state

---

# BROWSER COMPATIBILITY

Support:

- Chrome
- Edge
- Firefox
- Safari
- Mobile Safari
- Chrome Android

Gracefully degrade unsupported APIs.

Never assume support exists.

Always feature-detect.

---

# SECURITY REQUIREMENTS

Avoid:

- eval()
- unsafe innerHTML
- inline script injection
- unsafe file handling

Sanitize:

- User-generated content
- Imported JSON

Use defensive coding practices.

---

# CODE QUALITY REQUIREMENTS

Code must be:

- Production-ready
- Modular
- Extensively documented
- Self-explanatory
- Maintainable

Use:

- JSDoc
- Meaningful naming
- Separation of concerns
- Consistent architecture

Avoid:

- Duplicate code
- Global state pollution
- Tight coupling

---

# TESTING REQUIREMENTS

Generate a comprehensive testing section.

Include:

## Device Testing

- Mobile portrait
- Mobile landscape
- Tablet portrait
- Tablet landscape
- Desktop
- 4K
- 8K

## Functional Testing

- Playback
- Import/export
- Persistence
- Gestures
- Accessibility
- PWA install

## Edge Cases

- Empty playlists
- Huge playlists
- Large images
- Orientation changes
- Offline mode
- Unsupported APIs

---

# REQUIRED OUTPUT FORMAT

Provide output in the following order:

## 1. Executive Summary

High-level overview of improvements.

---

## 2. Existing Application Assessment

Detailed analysis of the original implementation.

---

## 3. Refactoring Strategy

Architecture decisions and rationale.

---

## 4. File Structure

Complete directory tree.

---

## 5. Complete Source Code

Output ALL code.

Do not omit sections.

Do not truncate.

Do not summarize code.

Include:

- HTML
- CSS
- Every JavaScript module
- Manifest
- Service worker

Clearly label each file.

---

## 6. Testing Notes

Detailed verification checklist.

---

## 7. Performance Improvements

Measured/expected improvements.

---

## 8. Accessibility Improvements

List all WCAG-related enhancements.

---

## 9. Trade-Offs & Compatibility Notes

Document any limitations.

---

# QUALITY STANDARD

Assume this application will be:

- Open-sourced
- Used on mobile devices daily
- Installed as a PWA
- Maintained for years
- Audited for accessibility
- Audited for performance

Every implementation decision should reflect professional enterprise-grade engineering standards.

Before producing the final output:

1. Verify all requirements are addressed.
2. Verify no existing functionality was lost.
3. Verify mobile usability.
4. Verify accessibility compliance.
5. Verify performance optimization.
6. Verify graceful degradation.
7. Verify code completeness.
8. Verify production readiness.

Produce the highest-quality implementation possible.