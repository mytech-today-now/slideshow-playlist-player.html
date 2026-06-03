You are an expert full-stack web developer and software architect with 15+ years of experience building robust, user-friendly media applications. You specialize in clean, maintainable HTML/CSS/JavaScript code, modern web standards, and best practices for desktop-like web apps.

**OBJECTIVE**
Refactor and enhance the media player application (starting with `player.html`) to implement the following features and improvements while preserving all existing functionality, UI/UX behavior, and performance characteristics.

**TASKS**

1. **JSON Export Enhancement (player.html)**
   - Modify the export functionality so that every exported .json file includes the **full absolute or relative file system path** for each media item (wherever paths are currently stored).
   - Ensure paths are properly escaped and platform-agnostic when possible.
   - Maintain backward compatibility for any existing import functionality.

2. **Playlist Features**
   - Add robust **Export** functionality for playlists (to .json).
   - Add robust **Import** functionality for playlists (from .json), including proper validation, error handling, and user feedback.
   - The exported playlist JSON must preserve the exact order of items.

3. **Media Library Improvements**
   - Implement sorting functionality in the Media Library that mirrors the existing sort capabilities in the Playlist and Slideshow sections.
   - Support common sort options: by name, date added, file size, duration, etc.
   - Include both ascending and descending order.
   - Persist sort preference if applicable.

4. **JSON Structure Standards**
   - Update all JSON export formats (player, playlist, media library, slideshow) to explicitly record and preserve the **order** of lists/items.
   - Use a consistent top-level structure where appropriate (e.g., `{ "version": "1.0", "items": [...], "order": [...] }` or similar).
   - Ensure all JSON files are human-readable and well-formatted.

5. **Repository Documentation and Configuration**
   - Create a comprehensive `README.md` in the root of the repository. Include:
     - Project description
     - Features list
     - Installation/usage instructions
     - How to export/import playlists and media libraries
     - Keyboard shortcuts (if any)
     - Technical details about JSON format
     - Contribution guidelines
   - Create a suitable `.gitignore` file that properly excludes common development artifacts, build files, OS files, and large media files.
   - Create a `VERSION` file containing the current semantic version (start at v1.1.0 or appropriate next version).

**REQUIREMENTS & GUIDELINES**
- Think step-by-step: Analyze current code structure before proposing changes.
- Maintain clean separation of concerns (HTML, CSS, JS).
- Use modern vanilla JavaScript (ES6+). Avoid external dependencies unless absolutely necessary.
- Implement proper error handling and user-friendly messages for import/export failures.
- Ensure all new features are accessible and work well with keyboard navigation.
- Follow consistent code style (use 2-space indentation, meaningful variable names, comments for complex sections).
- Make the code robust against missing files, malformed JSON, and edge cases (empty lists, very long paths, duplicate entries).
- Prioritize performance for large media libraries.
- Do not remove or break any existing features.

**OUTPUT FORMAT**
Respond with a complete, well-organized report containing:

1. **Summary of Changes** - Bullet list of all modifications.
2. **Updated Files** - For each modified or new file, provide the full file content in a clearly labeled markdown code block (e.g., ```html\n// player.html\n...```).
3. **Diff Summary** (optional but recommended for complex changes) - Show key diffs.
4. **New Files** - Full content for README.md, .gitignore, and VERSION.
5. **Testing Recommendations** - List key test cases to verify the new functionality.

Only output the requested sections. Be comprehensive yet concise. Do not add unnecessary commentary outside the specified structure.