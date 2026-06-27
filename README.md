<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Blend Player v5 • Dual-Layer Slideshow + Playlist Mixer</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=Space+Grotesk:wght@500;600&amp;display=swap');
        
        :root {
            --primary: 234 179 8;
        }
        
        .tail-container {
            font-family: 'Inter', system_ui, sans-serif;
        }
        
        .heading-font {
            font-family: 'Space Grotesk', sans-serif;
        }

        .hero-bg {
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
        }

        .glass {
            background: rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(16px);
        }

        .demo-frame {
            box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.4);
        }

        .feature-card {
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .feature-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
        }

        .nav-link {
            transition: all 0.2s ease;
        }
        
        .nav-link:hover {
            color: rgb(234 179 8);
        }

        .section-header {
            position: relative;
        }
        
        .section-header:after {
            content: '';
            position: absolute;
            width: 60px;
            height: 3px;
            background: rgb(234 179 8);
            bottom: -8px;
            left: 0;
        }

        .iframe-container {
            position: relative;
            padding-top: 56.25%;
        }
        
        .iframe-container iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border-radius: 16px;
        }
    </style>
</head>
<body class="tail-container bg-zinc-950 text-zinc-200">
    <!-- NAVBAR -->
    <nav class="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md fixed w-full z-50">
        <div class="max-w-screen-2xl mx-auto px-8 py-5 flex items-center justify-between">
            <div class="flex items-center gap-x-3">
                <div class="w-9 h-9 bg-yellow-500 rounded-2xl flex items-center justify-center text-zinc-950 font-bold text-2xl">B</div>
                <div>
                    <span class="heading-font text-2xl font-semibold tracking-tighter">Blend</span>
                    <span class="text-xs text-zinc-500 block -mt-1">Player v5</span>
                </div>
            </div>
            
            <div class="hidden md:flex items-center gap-x-8 text-sm font-medium">
                <a href="#demo" class="nav-link">Live Demo</a>
                <a href="#features" class="nav-link">Features</a>
                <a href="#quickstart" class="nav-link">Quick Start</a>
                <a href="#technical" class="nav-link">Technical</a>
            </div>
            
            <div class="flex items-center gap-x-4">
                <a href="https://mytech.today/tools/player/v/index.html" 
                   target="_blank"
                   class="px-6 py-2.5 bg-yellow-500 hover:bg-yellow-400 transition-colors text-zinc-950 font-semibold rounded-2xl flex items-center gap-x-2 text-sm">
                    <i class="fa-solid fa-play"></i>
                    <span>Try Live Now</span>
                </a>
            </div>
        </div>
    </nav>

    <!-- HERO -->
    <header class="hero-bg pt-24 pb-20">
        <div class="max-w-screen-2xl mx-auto px-8 pt-16">
            <div class="grid md:grid-cols-2 gap-16 items-center">
                <div class="space-y-8">
                    <div class="inline-flex items-center gap-x-2 bg-zinc-900 border border-yellow-500/30 text-yellow-400 text-sm px-4 py-1.5 rounded-3xl">
                        <div class="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                        Local-First • Private • Powerful
                    </div>
                    
                    <h1 class="heading-font text-6xl md:text-7xl font-semibold tracking-tighter leading-none">
                        Dual-layer media<br>that <span class="text-yellow-400">blends</span> perfectly
                    </h1>
                    
                    <p class="text-xl text-zinc-400 max-w-lg">
                        Run a video/audio playlist and an image/video slideshow simultaneously. 
                        Blend them live with independent controls. Built for creators, events, and immersive experiences.
                    </p>
                    
                    <div class="flex flex-wrap gap-4">
                        <a href="#demo" 
                           class="px-8 py-4 bg-white text-zinc-900 hover:bg-yellow-300 transition-all font-semibold rounded-3xl flex items-center gap-x-3 text-lg">
                            <i class="fa-solid fa-arrow-right"></i>
                            Launch the Demo
                        </a>
                        <a href="https://github.com/mytech-today-now/slideshow-playlist-player.html" 
                           target="_blank"
                           class="px-8 py-4 border border-zinc-700 hover:border-zinc-400 transition-all font-medium rounded-3xl flex items-center gap-x-3">
                            <i class="fa-brands fa-github"></i>
                            View on GitHub
                        </a>
                    </div>
                    
                    <div class="flex items-center gap-x-8 text-sm pt-6">
                        <div class="flex items-center gap-x-2">
                            <i class="fa-solid fa-check text-emerald-400"></i>
                            <span>100% Local Files</span>
                        </div>
                        <div class="flex items-center gap-x-2">
                            <i class="fa-solid fa-check text-emerald-400"></i>
                            <span>Supabase Remote Support</span>
                        </div>
                        <div class="flex items-center gap-x-2">
                            <i class="fa-solid fa-check text-emerald-400"></i>
                            <span>PWA Ready</span>
                        </div>
                    </div>
                </div>
                
                <!-- Hero Visual -->
                <div class="relative">
                    <div class="aspect-video bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-700 shadow-2xl">
                        <img src="https://picsum.photos/id/1015/1200/630" 
                             alt="Blend Player Interface" 
                             class="w-full h-full object-cover opacity-75">
                        <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent flex items-end p-8">
                            <div>
                                <div class="flex items-center gap-x-3 text-yellow-400 mb-2">
                                    <i class="fa-solid fa-layer-group"></i>
                                    <span class="font-mono text-sm tracking-widest">DUAL LAYER ACTIVE</span>
                                </div>
                                <p class="text-3xl font-light">Playlist + Slideshow</p>
                                <p class="text-zinc-400">Blended in real-time</p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Floating badges -->
                    <div class="absolute -top-6 -right-6 glass border border-yellow-500/30 rounded-2xl p-4 shadow-xl">
                        <div class="flex items-center gap-x-3">
                            <div class="text-4xl">🎞️</div>
                            <div>
                                <div class="font-semibold">17 Transitions</div>
                                <div class="text-xs text-zinc-400">Ken Burns + Effects</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </header>

    <!-- DEMO SECTION -->
    <section id="demo" class="py-20 bg-zinc-900">
        <div class="max-w-screen-2xl mx-auto px-8">
            <div class="text-center mb-12">
                <span class="px-4 py-2 bg-yellow-500/10 text-yellow-400 text-sm font-medium rounded-full">INTERACTIVE DEMO</span>
                <h2 class="heading-font text-5xl font-semibold tracking-tighter mt-4">Experience Blend in Action</h2>
                <p class="text-zinc-400 mt-3 max-w-md mx-auto">Fully functional embedded player. Add your own media, adjust the blend, and explore all controls.</p>
            </div>
            
            <div class="max-w-6xl mx-auto">
                <div class="iframe-container bg-black rounded-3xl overflow-hidden border-2 border-yellow-500/20">
                    <iframe src="https://mytech.today/tools/player/v/index.html" 
                            title="Blend Player v5 Demo"
                            class="demo-frame"
                            allowfullscreen></iframe>
                </div>
                
                <div class="flex justify-center mt-6 text-xs text-zinc-500 gap-x-8">
                    <div class="flex items-center gap-x-1.5">
                        <i class="fa-solid fa-keyboard"></i>
                        <span>Keyboard shortcuts enabled</span>
                    </div>
                    <div>•</div>
                    <div>Drag &amp; drop your media</div>
                </div>
            </div>
        </div>
    </section>

    <!-- FEATURES -->
    <section id="features" class="py-20 bg-zinc-950">
        <div class="max-w-screen-2xl mx-auto px-8">
            <div class="text-center mb-16">
                <h2 class="heading-font text-5xl font-semibold tracking-tighter">Powerful Dual-Layer Mixing</h2>
                <p class="text-zinc-400 mt-4">Everything you need for immersive local media experiences</p>
            </div>
            
            <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                <!-- Feature 1 -->
                <div class="feature-card bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                    <div class="w-12 h-12 bg-yellow-500/10 text-yellow-400 rounded-2xl flex items-center justify-center mb-6">
                        <i class="fa-solid fa-layer-group text-2xl"></i>
                    </div>
                    <h3 class="text-2xl font-semibold mb-3">Dual Layer Playback</h3>
                    <p class="text-zinc-400">Synchronized playlist (video/audio) and slideshow (images/videos) running independently with real-time blend control.</p>
                    <ul class="mt-6 space-y-3 text-sm">
                        <li class="flex gap-x-2 items-start"><i class="fa-solid fa-check text-emerald-400 mt-0.5"></i> Independent volume controls</li>
                        <li class="flex gap-x-2 items-start"><i class="fa-solid fa-check text-emerald-400 mt-0.5"></i> Precise pause/resume</li>
                        <li class="flex gap-x-2 items-start"><i class="fa-solid fa-check text-emerald-400 mt-0.5"></i> Master volume + mute</li>
                    </ul>
                </div>
                
                <!-- Feature 2 -->
                <div class="feature-card bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                    <div class="w-12 h-12 bg-yellow-500/10 text-yellow-400 rounded-2xl flex items-center justify-center mb-6">
                        <i class="fa-solid fa-images text-2xl"></i>
                    </div>
                    <h3 class="text-2xl font-semibold mb-3">Rich Slideshow Engine</h3>
                    <p class="text-zinc-400">17 transition effects, Ken Burns motion, per-item durations, video audio toggles, and randomized sequencing.</p>
                    <div class="mt-8 pt-8 border-t border-zinc-800 text-xs uppercase tracking-widest text-zinc-500">Supported: JPG, PNG, WebP, GIF, MP4 + more</div>
                </div>
                
                <!-- Feature 3 -->
                <div class="feature-card bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                    <div class="w-12 h-12 bg-yellow-500/10 text-yellow-400 rounded-2xl flex items-center justify-center mb-6">
                        <i class="fa-solid fa-list-check text-2xl"></i>
                    </div>
                    <h3 class="text-2xl font-semibold mb-3">Smart Media Library</h3>
                    <p class="text-zinc-400">Add files, entire folders (recursive), URLs, drag &amp; drop. Powerful search, filters, and virtualized lists.</p>
                </div>
                
                <!-- Feature 4 -->
                <div class="feature-card bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                    <div class="w-12 h-12 bg-yellow-500/10 text-yellow-400 rounded-2xl flex items-center justify-center mb-6">
                        <i class="fa-solid fa-save text-2xl"></i>
                    </div>
                    <h3 class="text-2xl font-semibold mb-3">Experiences &amp; Persistence</h3>
                    <p class="text-zinc-400">Save complete setups as Experiences. IndexedDB + LocalStorage. Import/export full JSON snapshots.</p>
                </div>
                
                <!-- Feature 5 -->
                <div class="feature-card bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                    <div class="w-12 h-12 bg-yellow-500/10 text-yellow-400 rounded-2xl flex items-center justify-center mb-6">
                        <i class="fa-solid fa-share-nodes text-2xl"></i>
                    </div>
                    <h3 class="text-2xl font-semibold mb-3">Deep Linking &amp; Sharing</h3>
                    <p class="text-zinc-400">Share specific experiences, layers, and autoplay states. Native Web Share API support.</p>
                </div>
                
                <!-- Feature 6 -->
                <div class="feature-card bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                    <div class="w-12 h-12 bg-yellow-500/10 text-yellow-400 rounded-2xl flex items-center justify-center mb-6">
                        <i class="fa-solid fa-mobile-screen text-2xl"></i>
                    </div>
                    <h3 class="text-2xl font-semibold mb-3">PWA + Responsive</h3>
                    <p class="text-zinc-400">Installable as a desktop/mobile app. Excellent touch and keyboard support. Works offline for cached assets.</p>
                </div>
            </div>
        </div>
    </section>

    <!-- QUICK START -->
    <section id="quickstart" class="py-20 bg-zinc-900">
        <div class="max-w-screen-2xl mx-auto px-8">
            <div class="grid lg:grid-cols-12 gap-16">
                <div class="lg:col-span-5">
                    <div class="sticky top-28">
                        <h2 class="heading-font text-5xl font-semibold tracking-tighter">Get Started in Seconds</h2>
                        <p class="text-zinc-400 mt-6 text-lg">No account. No uploads. Just open and play your media.</p>
                        
                        <div class="mt-12 border-l-2 border-yellow-500 pl-8">
                            <div class="text-yellow-400 text-sm font-mono mb-1">PRO TIP</div>
                            <p class="text-sm">Press <span class="font-mono bg-zinc-800 px-2 py-0.5 rounded">C</span> anytime to open Configuration</p>
                        </div>
                    </div>
                </div>
                
                <div class="lg:col-span-7">
                    <div class="space-y-8">
                        <div class="flex gap-6">
                            <div class="w-10 h-10 flex-shrink-0 bg-yellow-500 text-zinc-950 rounded-2xl flex items-center justify-center font-bold">1</div>
                            <div>
                                <h3 class="font-semibold text-xl">Open the Player</h3>
                                <p class="text-zinc-400">Visit the live demo above or run locally from <code class="text-xs bg-zinc-800 px-2 py-1 rounded">src/blend.v5.0.8/index.html</code></p>
                            </div>
                        </div>
                        
                        <div class="flex gap-6">
                            <div class="w-10 h-10 flex-shrink-0 bg-yellow-500 text-zinc-950 rounded-2xl flex items-center justify-center font-bold">2</div>
                            <div>
                                <h3 class="font-semibold text-xl">Add Your Media</h3>
                                <p class="text-zinc-400">Use Add Files, Add Folder, Add URL, or drag &amp; drop. Supports images, videos, audio, and more.</p>
                            </div>
                        </div>
                        
                        <div class="flex gap-6">
                            <div class="w-10 h-10 flex-shrink-0 bg-yellow-500 text-zinc-950 rounded-2xl flex items-center justify-center font-bold">3</div>
                            <div>
                                <h3 class="font-semibold text-xl">Build Your Layers</h3>
                                <p class="text-zinc-400">Select items from Media Library and add to Playlist or Slideshow. Reorder, shuffle, or set per-item options.</p>
                            </div>
                        </div>
                        
                        <div class="flex gap-6">
                            <div class="w-10 h-10 flex-shrink-0 bg-yellow-500 text-zinc-950 rounded-2xl flex items-center justify-center font-bold">4</div>
                            <div>
                                <h3 class="font-semibold text-xl">Play &amp; Blend</h3>
                                <p class="text-zinc-400">Hit Play. Adjust the blend slider, volumes, and enjoy seamless synchronized playback.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- TECHNICAL DETAILS -->
    <section id="technical" class="py-20 bg-zinc-950 border-t border-zinc-800">
        <div class="max-w-screen-2xl mx-auto px-8">
            <h2 class="heading-font text-5xl font-semibold tracking-tighter text-center mb-16">Full Documentation</h2>
            
            <div class="max-w-4xl mx-auto space-y-6">
                <!-- Collapsible sections -->
                <details class="group bg-zinc-900 border border-zinc-800 rounded-3xl">
                    <summary class="px-8 py-6 flex justify-between items-center cursor-pointer hover:bg-zinc-800 transition-colors rounded-3xl">
                        <span class="font-semibold text-lg">Supported File Types</span>
                        <i class="fa-solid fa-chevron-down transition-transform group-open:rotate-180"></i>
                    </summary>
                    <div class="px-8 pb-8 text-zinc-400 text-sm leading-relaxed">
                        <div class="grid grid-cols-3 gap-6">
                            <div>
                                <h4 class="font-medium text-white mb-3">Images</h4>
                                <ul class="space-y-1">
                                    <li>JPG, PNG, WebP, GIF, SVG, AVIF...</li>
                                </ul>
                            </div>
                            <div>
                                <h4 class="font-medium text-white mb-3">Video</h4>
                                <ul class="space-y-1">
                                    <li>MP4, WebM, MOV, MKV...</li>
                                </ul>
                            </div>
                            <div>
                                <h4 class="font-medium text-white mb-3">Audio</h4>
                                <ul class="space-y-1">
                                    <li>MP3, M4A, WAV, OGG...</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </details>
                
                <details class="group bg-zinc-900 border border-zinc-800 rounded-3xl">
                    <summary class="px-8 py-6 flex justify-between items-center cursor-pointer hover:bg-zinc-800 transition-colors rounded-3xl">
                        <span class="font-semibold text-lg">Keyboard Shortcuts</span>
                        <i class="fa-solid fa-chevron-down transition-transform group-open:rotate-180"></i>
                    </summary>
                    <div class="px-8 pb-8">
                        <table class="w-full text-sm">
                            <thead>
                                <tr class="border-b border-zinc-700">
                                    <th class="text-left py-3 font-medium">Shortcut</th>
                                    <th class="text-left py-3 font-medium">Action</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-zinc-800 text-zinc-400">
                                <tr><td class="py-3 font-mono">Space / K</td><td>Play / Pause</td></tr>
                                <tr><td class="py-3 font-mono">S</td><td>Stop &amp; Reset</td></tr>
                                <tr><td class="py-3 font-mono">[ ] </td><td>Blend opacity</td></tr>
                                <tr><td class="py-3 font-mono">C</td><td>Config Panel</td></tr>
                                <tr><td class="py-3 font-mono">F</td><td>Fullscreen</td></tr>
                            </tbody>
                        </table>
                    </div>
                </details>
                
                <details class="group bg-zinc-900 border border-zinc-800 rounded-3xl">
                    <summary class="px-8 py-6 flex justify-between items-center cursor-pointer hover:bg-zinc-800 transition-colors rounded-3xl">
                        <span class="font-semibold text-lg">Feature Matrix &amp; Architecture</span>
                        <i class="fa-solid fa-chevron-down transition-transform group-open:rotate-180"></i>
                    </summary>
                    <div class="px-8 pb-8 prose prose-invert text-zinc-400 max-w-none">
                        <p>Blend is built with native browser technologies: ES Modules, IndexedDB, File System Access API, and more. No heavy frameworks.</p>
                        <ul>
                            <li>Local-first with robust persistence</li>
                            <li>Supabase integration for remote media</li>
                            <li>Service Worker PWA support</li>
                            <li>Virtualized lists for large libraries</li>
                        </ul>
                    </div>
                </details>
                
                <details class="group bg-zinc-900 border border-zinc-800 rounded-3xl">
                    <summary class="px-8 py-6 flex justify-between items-center cursor-pointer hover:bg-zinc-800 transition-colors rounded-3xl">
                        <span class="font-semibold text-lg">Data Persistence &amp; Privacy</span>
                        <i class="fa-solid fa-chevron-down transition-transform group-open:rotate-180"></i>
                    </summary>
                    <div class="px-8 pb-8 text-sm text-zinc-400">
                        <p class="mb-4">Your media stays on your device. The app uses IndexedDB for library state, experiences, and thumbnails. No files are uploaded unless you explicitly use remote URLs.</p>
                        <p>Clear Browser Storage option available for full reset.</p>
                    </div>
                </details>
            </div>
        </div>
    </section>

    <!-- FOOTER -->
    <footer class="bg-black py-16 border-t border-zinc-900">
        <div class="max-w-screen-2xl mx-auto px-8">
            <div class="flex flex-col md:flex-row justify-between items-center gap-8">
                <div class="flex items-center gap-x-3">
                    <div class="w-8 h-8 bg-yellow-500 rounded-2xl flex items-center justify-center text-zinc-950 text-xl font-bold">B</div>
                    <div class="text-sm">
                        <div class="font-medium">Blend Player v5</div>
                        <div class="text-zinc-500">by myTech.Today</div>
                    </div>
                </div>
                
                <div class="text-center text-xs text-zinc-500">
                    Built for creators who value privacy and control.<br>
                    All media remains local.
                </div>
                
                <div class="flex gap-x-6 text-zinc-400">
                    <a href="https://github.com/mytech-today-now/slideshow-playlist-player.html" target="_blank" class="hover:text-yellow-400 transition-colors">
                        <i class="fa-brands fa-github text-2xl"></i>
                    </a>
                    <a href="https://mytech.today/" target="_blank" class="hover:text-yellow-400 transition-colors">
                        <i class="fa-solid fa-globe text-2xl"></i>
                    </a>
                </div>
            </div>
            
            <div class="text-center text-[10px] text-zinc-600 mt-16">
                MIT Licensed • Open Source • Version 5.0.x
            </div>
        </div>
    </footer>

    <script>
        // Tailwind script already loaded
        function initTailwind() {
            // Additional custom styles if needed
        }
        
        window.onload = function() {
            initTailwind();
            
            // Smooth scroll for anchor links
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', function(e) {
                    if (this.getAttribute('href') !== '#') {
                        e.preventDefault();
                        const target = document.querySelector(this.getAttribute('href'));
                        if (target) {
                            target.scrollIntoView({
                                behavior: 'smooth'
                            });
                        }
                    }
                });
            });
        };
    </script>
</body>
</html>