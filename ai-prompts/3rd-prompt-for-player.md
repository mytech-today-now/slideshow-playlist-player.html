You are a world-class full-stack frontend engineer and UI/UX expert specializing in high-performance, elegant single-file HTML5 media applications. You have deep expertise in modern JavaScript (ES2023+), IndexedDB, File System Access API, CSS Grid/Flexbox, smooth animations, accessibility, and buttery-smooth media playback experiences.

**OBJECTIVE**
Refactor the complete `player.html` file (provided below in its entirety) to incorporate all the following improvements and best practices while preserving its core functionality, dark aesthetic, keyboard shortcuts, persistence, and professional polish. Produce the full updated source code as output.

**KEY REQUIREMENTS**

1. **Media Library Enhancements**
   - Implement robust multi-select: 
     - Click to select single item (clears previous selection).
     - Ctrl/Cmd + Click for toggle individual selection.
     - Shift + Click for range selection from last selected item.
   - Add visual feedback for selected items (stronger accent border + subtle background).
   - Add sorting capabilities to the library:
     - Add a "Sort ▾" button in the library pane header/actions area.
     - Support sorting by: Name (A-Z/Z-A), File Size, Type, Date Added, and (if available) Duration.
     - Make sorting persistent per session or saved in settings.
   - Selected items should be easy to add to either Playlist or Slideshow via dedicated buttons.

2. **Layout & UI Improvements**
   - Make the configuration panel (#config-panel) significantly larger: occupy ~85-92% of the viewport width (with a reasonable max-width cap around 1280px) and nearly full height. It should feel like a primary workspace.
   - The main viewport (#viewport) should take up the entire remaining space (full width and height minus only the transport controls at the bottom).
   - Center all player controls (#transport) horizontally at the bottom of the window. Use flexbox for clean alignment. Ensure they remain visible and accessible.
   - Ensure all media (images, videos) in both layers are perfectly centered both horizontally and vertically within the viewport using best practices (object-fit: contain + flex centering).

3. **Slideshow Preloading & Smooth Transitions**
   - Implement intelligent preloading for the next 1-2 slideshow items (images and videos) in the background.
   - Eliminate any noticeable black flash/blankness during transitions between slideshow items.
   - Use cross-fading with opacity transitions (600-800ms) combined with preloaded elements.
   - For images: preload the next image as a hidden element and swap with smooth fade.
   - For videos: preload metadata and first frame where possible.
   - Maintain Ken Burns effect continuity where active.
   - Add a subtle loading indicator only when necessary (minimal visual noise).

4. **General Polish & Best Practices**
   - Ensure excellent responsive behavior (especially on smaller screens).
   - Maintain or improve accessibility (ARIA labels, keyboard navigation, focus management).
   - Keep all existing keyboard shortcuts and add any logical new ones for the new features (e.g., sorting hotkeys).
   - Preserve all persistence (IndexedDB), drag-and-drop, import/export, and dual-layer blending logic.
   - Optimize performance: avoid memory leaks with blob URLs, efficient thumbnail generation, and proper cleanup.
   - Use modern, clean, consistent code style with detailed comments for major changes.
   - Include any missing robustness (error handling for missing files, graceful fallbacks).

**REASONING INSTRUCTIONS**
Before writing code, think step-by-step:
1. Analyze current structure and identify where changes are needed (library rendering, event handlers, CSS, slideshow logic).
2. Plan the multi-select state management and range selection logic.
3. Design smooth preloading architecture (e.g., a preload queue or Map of promises).
4. Ensure layout changes do not break existing transport or config interactions.

**OUTPUT FORMAT**
Respond with ONLY the complete, self-contained refactored `player.html` file (from <!DOCTYPE html> to </html>) inside a single markdown code block:
```html
[full updated code here]
```
Do not include explanations, summaries, or additional commentary outside the code block. The code must be ready to save and run as a standalone file.

**CONSTRAINTS**
- Do not remove or break any existing features (dual layers, blend slider, volumes, persistence, etc.).
- Stay faithful to the original elegant dark theme with --accent #ff1493.
- Prioritize smoothness and visual delight.
- Be comprehensive but avoid unnecessary bloat.

Here is the original full `player.html` code to refactor:

[Insert the entire provided player.html content here]