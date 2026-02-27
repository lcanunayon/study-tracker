WELCOME SCREEN IMAGES
=====================

Place your screenshot PNGs in this folder, then copy them to
dist/renderer/assets/ as well (both folders need the same files).

Quick copy command (run from project root):
  cp src/renderer/assets/*.png dist/renderer/assets/


REQUIRED FILES
--------------

welcome-overview.jpg
  Full-screen screenshot of the workspace canvas with a few items on it.
  Recommended size: 1200 x 650 px (or any 16:9 widescreen crop)
  Shows: the canvas, toolbar, a few notes/images/connections

welcome-toolbar.jpg
  Close-up screenshot of just the toolbar strip at the top of the workspace.
  Recommended size: 1100 x 60 px (or a tall enough crop to be readable)
  Shows: all tool buttons + the contextual options area

NOTE: Both PNG and JPG formats work — just make sure the filename and
extension in app.ts match what you place here.


HOW TO ADD IMAGES
-----------------
1. Take a screenshot of your app (Win+Shift+S on Windows).
2. Save/export it as a JPG with one of the filenames above.
3. Drop it into THIS folder  (src/renderer/assets/).
4. Also drop a copy into    dist/renderer/assets/
   (or run the copy command above).
5. Relaunch the app — placeholders are replaced automatically.
