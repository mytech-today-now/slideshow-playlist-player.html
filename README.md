<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Blend Player v5 • Dual-Layer Media Studio</title>
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
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        }

        .glass {
            background: rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(12px);
        }

        .nav-link {
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .nav-link:hover {
            color: rgb(234 179 8);
            transform: translateY(-1px);
        }

        .feature-card {
            transition: all 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
        }
        
        .feature-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
        }

        .demo-frame {
            box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.4);
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

        .blend-slider {
            background: linear-gradient(to right, #eab308, #f59e0b);
        }
    </style>
</head>
<body class="tail-container bg-zinc-950 text-zinc-200">
    <!-- NAVBAR -->
    <nav class="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-lg">
        <div class="max-w-screen-2xl mx-auto px-8 py-5 flex items-center justify-between">
            <div class="flex items-center gap-x-3">
                <div class="w-9 h-9 bg-yellow-500 rounded-2xl flex items-center justify-center text-zinc-950 font-bold text-2xl leading-none pt-0.5">B</div>
                <div>
                    <span class="heading-font text-2xl font-semibold tracking-tighter">Blend</span>
                    <span class="text-xs text-zinc-500 block -mt-1">Player v5</span>
                </div>
            </div>
            
            <div class="hidden md:flex items-center gap-x-8 text-sm font-medium">
                <a href="#demo" onclick="document.getElementById('demo').scrollIntoView({behavior:'smooth'})" class="nav-link">Live Demo</a>
                <a href="#features" onclick="document.getElementById('features').scrollIntoView({behavior:'smooth'})" class="nav-link">Features</a>
                <a href="#quickstart" onclick="document.getElementById('quickstart').scrollIntoView({behavior:'smooth'})" class="nav-link">Quick Start</a>
                <a href="#tech" onclick="document.getElementById('tech').scrollIntoView({behavior:'smooth'})" class="nav-link">Technical</a>
            </div>
            
            <div class="flex items-center gap-x-4">
                <a href="https://mytech.today/tools/player/v/index.html" 
                   target="_blank"
                   class="px-6 py-2.5 bg-yellow-500 hover:bg-yellow-400 transition-colors text-zinc-950 font-semibold rounded-2xl flex items-center gap-x-2 text-sm">
                    <i class="fa-solid fa-play"></i>
                    <span>Launch App</span>
                </a>
                <a href="https://github.com/mytech-today-now/slideshow-playlist-player.html" 
                   target="_blank"
                   class="px-5 py-2.5 border border-zinc-700 hover:border-zinc-400 transition-colors rounded-2xl text-sm flex items-center gap-x-2">
                    <i class="fa-brands fa-github"></i>
                </a>
            </div>
        </div>
    </nav>

    <!-- HERO -->
    <header class="hero-bg pt-24 pb-20">
        <div class="max-w-screen-2xl mx-auto px-8 pt-12">
            <div class="grid md:grid-cols-2 gap-16 items-center">
                <div class="space-y-8">
                    <div class="inline-flex items-center gap-x-2 px-4 py-1.5 bg-white/10 rounded-3xl text-sm border border-white/20">
                        <div class="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                        Local-First • Private • Powerful
                    </div>
                    
                    <h1 class="heading-font text-7xl md:text-8xl font-semibold tracking-tighter leading-none">
                        Dual-layer<br>media magic.<br>
                        <span class="text-yellow-400">Live blended.</span>
                    </h1>
                    
                    <p class="text-xl text-zinc-400 max-w-lg">
                        Run a video/audio playlist and an image/video slideshow simultaneously. 
                        Blend them live. Perfect for events, ambient experiences, and creative performances.
                    </p>
                    
                    <div class="flex flex-wrap gap-4">
                        <a href="#demo" 
                           onclick="document.getElementById('demo').scrollIntoView({behavior:'smooth'})"
                           class="px-8 py-4 bg-yellow-500 hover:bg-amber-300 transition-all text-zinc-950 font-semibold text-lg rounded-3xl flex items-center gap-x-3 group">
                            <span>Try Live Demo</span>
                            <i class="fa-solid fa-arrow-right group-active:translate-x-1 transition"></i>
                        </a>
                        
                        <a href="https://github.com/mytech-today-now/slideshow-playlist-player.html" 
                           target="_blank"
                           class="px-8 py-4 border-2 border-white/70 hover:border-white text-white font-medium rounded-3xl flex items-center gap-x-2 transition">
                            <i class="fa-brands fa-github"></i>
                            <span>View on GitHub</span>
                        </a>
                    </div>
                    
                    <div class="flex items-center gap-x-8 text-sm pt-4">
                        <div class="flex items-center gap-x-3">
                            <i class="fa-solid fa-check text-emerald-400"></i>
                            <span>No uploads</span>
                        </div>
                        <div class="flex items-center gap-x-3">
                            <i class="fa-solid fa-check text-emerald-400"></i>
                            <span>Works offline</span>
                        </div>
                        <div class="flex items-center gap-x-3">
                            <i class="fa-solid fa-check text-emerald-400"></i>
                            <span>PWA ready</span>
                        </div>
                    </div>
                </div>
                
                <!-- Visual mock -->
                <div class="relative hidden md:block">
                    <div class="absolute -inset-8 bg-gradient-to-br from-yellow-400/20 to-transparent rounded-[4rem] -rotate-6"></div>
                    <div class="relative bg-zinc-900 rounded-3xl p-2 border border-yellow-400/30 shadow-2xl">
                        <img src="https://picsum.photos/id/1015/800/520" alt="Blend Player Interface" 
                             class="rounded-2xl shadow-inner w-full">
                        <div class="absolute bottom-8 left-8 right-8 bg-black/70 backdrop-blur-md rounded-2xl p-4 flex items-center justify-between text-xs">
                            <div class="flex items-center gap-x-6">
                                <div class="flex flex-col items-center">
                                    <div class="text-[10px] text-zinc-400">BLEND</div>
                                    <div class="h-1.5 w-20 bg-yellow-400 rounded-full relative">
                                        <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="text-emerald-400 text-sm font-medium">PLAYING</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </header>

    <!-- DEMO SECTION -->
    <section id="demo" class="py-24 bg-zinc-900">
        <div class="max-w-screen-2xl mx-auto px-8">
            <div class="text-center mb-12">
                <span class="px-4 py-2 bg-yellow-500/10 text-yellow-400 text-sm font-medium rounded-3xl">Interactive Demo</span>
                <h2 class="heading-font text-5xl font-semibold tracking-tight mt-4">Experience Blend in your browser</h2>
                <p class="text-zinc-400 mt-3 max-w-md mx-auto">The full app embedded below. Add your own media, create experiences, and blend layers live.</p>
            </div>
            
            <div class="max-w-6xl mx-auto">
                <div class="bg-zinc-950 rounded-3xl p-3 border border-zinc-800 demo-frame">
                    <iframe id="blend-iframe" 
                            src="https://mytech.today/tools/player/v/index.html"
                            class="w-full aspect-video bg-black rounded-2xl"
                            allow="fullscreen; autoplay; clipboard-write"
                            title="Blend Player Live Demo"></iframe>
                </div>
                
                <div class="flex justify-center gap-x-6 mt-8 text-sm">
                    <div onclick="document.getElementById('blend-iframe').contentWindow.location.reload()" 
                         class="cursor-pointer flex items-center gap-x-2 px-5 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-2xl transition-colors">
                        <i class="fa-solid fa-rotate"></i>
                        <span>Reload Demo</span>
                    </div>
                    <a href="https://mytech.today/tools/player/v/index.html" target="_blank"
                       class="flex items-center gap-x-2 px-5 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-2xl transition-colors">
                        <i class="fa-solid fa-up-right-from-square"></i>
                        <span>Open Fullscreen</span>
                    </a>
                </div>
            </div>
        </div>
    </section>

    <!-- QUICK START -->
    <section id="quickstart" class="py-24 border-t border-zinc-800">
        <div class="max-w-screen-2xl mx-auto px-8">
            <div class="grid md:grid-cols-12 gap-16">
                <div class="md:col-span-5">
                    <span class="text-yellow-400 text-sm font-medium tracking-widest">GET STARTED IN 60 SECONDS</span>
                    <h2 class="heading-font text-5xl font-semibold tracking-tighter mt-3">Simple. Powerful.<br>Instantly usable.</h2>
                    <p class="mt-6 text-lg text-zinc-400">No accounts. No cloud uploads. Just open and create immersive media experiences.</p>
                    
                    <div class="mt-10 space-y-6">
                        <div class="flex gap-5">
                            <div class="w-8 h-8 rounded-2xl bg-yellow-500/10 flex items-center justify-center text-yellow-400 flex-shrink-0">1</div>
                            <div>
                                <div class="font-semibold">Open the app</div>
                                <div class="text-zinc-400">Launch via the live demo above or run locally</div>
                            </div>
                        </div>
                        <div class="flex gap-5">
                            <div class="w-8 h-8 rounded-2xl bg-yellow-500/10 flex items-center justify-center text-yellow-400 flex-shrink-0">2</div>
                            <div>
                                <div class="font-semibold">Add media</div>
                                <div class="text-zinc-400">Drag &amp; drop files/folders or add URLs</div>
                            </div>
                        </div>
                        <div class="flex gap-5">
                            <div class="w-8 h-8 rounded-2xl bg-yellow-500/10 flex items-center justify-center text-yellow-400 flex-shrink-0">3</div>
                            <div>
                                <div class="font-semibold">Build layers</div>
                                <div class="text-zinc-400">Populate your Playlist and Slideshow</div>
                            </div>
                        </div>
                        <div class="flex gap-5">
                            <div class="w-8 h-8 rounded-2xl bg-yellow-500/10 flex items-center justify-center text-yellow-400 flex-shrink-0">4</div>
                            <div>
                                <div class="font-semibold">Blend &amp; perform</div>
                                <div class="text-zinc-400">Hit play and adjust the blend slider in real-time</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="md:col-span-7">
                    <div class="glass border border-white/10 rounded-3xl p-8">
                        <h3 class="font-semibold text-xl mb-6 flex items-center gap-x-3">
                            <i class="fa-solid fa-keyboard"></i>
                            Keyboard Shortcuts
                        </h3>
                        <div class="grid grid-cols-2 gap-4 text-sm">
                            <div class="flex justify-between bg-zinc-900/50 px-5 py-3 rounded-2xl">
                                <span class="text-zinc-400">Space / K</span>
                                <span class="font-mono">Play / Pause</span>
                            </div>
                            <div class="flex justify-between bg-zinc-900/50 px-5 py-3 rounded-2xl">
                                <span class="text-zinc-400">S</span>
                                <span class="font-mono">Stop + Reset</span>
                            </div>
                            <div class="flex justify-between bg-zinc-900/50 px-5 py-3 rounded-2xl">
                                <span class="text-zinc-400">[ ] </span>
                                <span class="font-mono">Blend ±10%</span>
                            </div>
                            <div class="flex justify-between bg-zinc-900/50 px-5 py-3 rounded-2xl">
                                <span class="text-zinc-400">C</span>
                                <span class="font-mono">Config Panel</span>
                            </div>
                            <div class="flex justify-between bg-zinc-900/50 px-5 py-3 rounded-2xl">
                                <span class="text-zinc-400">F</span>
                                <span class="font-mono">Fullscreen</span>
                            </div>
                            <div class="flex justify-between bg-zinc-900/50 px-5 py-3 rounded-2xl">
                                <span class="text-zinc-400">1-9</span>
                                <span class="font-mono">Seek 10-90%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- FEATURES -->
    <section id="features" class="py-24 bg-zinc-950 border-t border-b border-zinc-800">
        <div class="max-w-screen-2xl mx-auto px-8">
            <div class="text-center mb-16">
                <span class="uppercase tracking-[2px] text-yellow-400 text-sm">Capabilities</span>
                <h2 class="heading-font text-5xl font-semibold mt-3">Everything you need to create immersive experiences</h2>
            </div>
            
            <div class="grid md:grid-cols-3 gap-8">
                <!-- Card 1 -->
                <div class="feature-card bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                    <div class="w-12 h-12 bg-yellow-500/10 text-yellow-400 rounded-2xl flex items-center justify-center text-3xl mb-6">
                        🎞️
                    </div>
                    <h3 class="text-2xl font-semibold mb-2">Dual Layer Playback</h3>
                    <p class="text-zinc-400">Synchronized playlist (video + audio) and slideshow (images + video). Independent controls with live blend opacity.</p>
                    <ul class="mt-8 space-y-3 text-sm">
                        <li class="flex items-center gap-x-2"><i class="fa-solid fa-check text-emerald-400 text-xs"></i> Precise pause/resume</li>
                        <li class="flex items-center gap-x-2"><i class="fa-solid fa-check text-emerald-400 text-xs"></i> Master + per-layer volume</li>
                        <li class="flex items-center gap-x-2"><i class="fa-solid fa-check text-emerald-400 text-xs"></i> 17+ transition effects</li>
                    </ul>
                </div>
                
                <!-- Card 2 -->
                <div class="feature-card bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                    <div class="w-12 h-12 bg-yellow-500/10 text-yellow-400 rounded-2xl flex items-center justify-center text-3xl mb-6">
                        📚
                    </div>
                    <h3 class="text-2xl font-semibold mb-2">Rich Media Library</h3>
                    <p class="text-zinc-400">Local-first. Supports folders, drag &amp; drop, URLs (including Supabase), and powerful search/filter tools.</p>
                    <ul class="mt-8 space-y-3 text-sm">
                        <li class="flex items-center gap-x-2"><i class="fa-solid fa-check text-emerald-400 text-xs"></i> Recursive folder import</li>
                        <li class="flex items-center gap-x-2"><i class="fa-solid fa-check text-emerald-400 text-xs"></i> Virtualized lists for speed</li>
                        <li class="flex items-center gap-x-2"><i class="fa-solid fa-check text-emerald-400 text-xs"></i> Thumbnail caching</li>
                    </ul>
                </div>
                
                <!-- Card 3 -->
                <div class="feature-card bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                    <div class="w-12 h-12 bg-yellow-500/10 text-yellow-400 rounded-2xl flex items-center justify-center text-3xl mb-6">
                        💾
                    </div>
                    <h3 class="text-2xl font-semibold mb-2">Experiences &amp; Persistence</h3>
                    <p class="text-zinc-400">Save, export, and share complete sessions including media references, settings, and playback state.</p>
                    <ul class="mt-8 space-y-3 text-sm">
                        <li class="flex items-center gap-x-2"><i class="fa-solid fa-check text-emerald-400 text-xs"></i> JSON import/export</li>
                        <li class="flex items-center gap-x-2"><i class="fa-solid fa-check text-emerald-400 text-xs"></i> Deep linking</li>
                        <li class="flex items-center gap-x-2"><i class="fa-solid fa-check text-emerald-400 text-xs"></i> IndexedDB + PWA</li>
                    </ul>
                </div>
            </div>
        </div>
    </section>

    <!-- HOW IT WORKS -->
    <section class="py-24 bg-zinc-900">
        <div class="max-w-screen-2xl mx-auto px-8">
            <div class="max-w-2xl mx-auto text-center mb-16">
                <h2 class="heading-font text-5xl font-semibold tracking-tighter">How Blend Works</h2>
                <p class="text-zinc-400 mt-4">Two synchronized layers. Infinite creative possibilities.</p>
            </div>
            
            <div class="grid md:grid-cols-2 gap-12 max-w-5xl mx-auto">
                <div class="space-y-8">
                    <div class="flex gap-6">
                        <div class="flex-shrink-0">
                            <div class="w-7 h-7 bg-yellow-400 text-zinc-950 rounded-xl flex items-center justify-center font-bold text-sm">P</div>
                        </div>
                        <div>
                            <div class="font-semibold text-lg">Playlist Layer</div>
                            <div class="text-zinc-400">Video and audio sequences. Full transport controls, seeking, shuffle, and reorder.</div>
                        </div>
                    </div>
                    <div class="flex gap-6">
                        <div class="flex-shrink-0">
                            <div class="w-7 h-7 bg-yellow-400 text-zinc-950 rounded-xl flex items-center justify-center font-bold text-sm">S</div>
                        </div>
                        <div>
                            <div class="font-semibold text-lg">Slideshow Layer</div>
                            <div class="text-zinc-400">Images and videos with per-item timing, Ken Burns effects, and rich transitions.</div>
                        </div>
                    </div>
                </div>
                
                <div class="bg-zinc-950 border border-yellow-400/30 rounded-3xl p-8 text-center">
                    <div class="text-6xl mb-6">🎛️</div>
                    <div class="text-xl font-medium">Live Blend Control</div>
                    <p class="text-zinc-400 mt-3">Adjust opacity between layers in real time with a beautiful slider. Perfect for live performances and ambient installations.</p>
                    <div class="mt-8 h-2 bg-gradient-to-r from-transparent via-yellow-400 to-transparent rounded-full"></div>
                </div>
            </div>
        </div>
    </section>

    <!-- TECHNICAL DETAILS -->
    <section id="tech" class="py-24 border-t border-zinc-800 bg-zinc-950">
        <div class="max-w-screen-2xl mx-auto px-8">
            <h2 class="heading-font text-5xl font-semibold text-center mb-16">Technical Excellence</h2>
            
            <div class="max-w-4xl mx-auto space-y-6">
                <!-- Collapsibles -->
                <details class="group bg-zinc-900 border border-zinc-800 rounded-3xl">
                    <summary class="px-8 py-6 flex justify-between items-center cursor-pointer list-none">
                        <span class="font-semibold text-lg">Supported Media &amp; Formats</span>
                        <span class="text-yellow-400 transition-transform group-open:rotate-180">↓</span>
                    </summary>
                    <div class="px-8 pb-8 text-zinc-400 text-sm">
                        <p class="mb-6">Images: JPG, PNG, WebP, GIF, SVG, AVIF and more.<br>
                        Video: MP4, WebM, MOV and more.<br>
                        Audio: MP3, WAV, M4A and more.</p>
                        <p>Full list available in the original README.</p>
                    </div>
                </details>
                
                <details class="group bg-zinc-900 border border-zinc-800 rounded-3xl">
                    <summary class="px-8 py-6 flex justify-between items-center cursor-pointer list-none">
                        <span class="font-semibold text-lg">Persistence &amp; Privacy</span>
                        <span class="text-yellow-400 transition-transform group-open:rotate-180">↓</span>
                    </summary>
                    <div class="px-8 pb-8 text-zinc-400 text-sm space-y-4">
                        <p><strong>Local-first by design.</strong> All media stays on your device. IndexedDB for state, LocalStorage for session flags.</p>
                        <p>Export full experiences as JSON for backup and portability.</p>
                    </div>
                </details>
                
                <details class="group bg-zinc-900 border border-zinc-800 rounded-3xl">
                    <summary class="px-8 py-6 flex justify-between items-center cursor-pointer list-none">
                        <span class="font-semibold text-lg">Browser Compatibility</span>
                        <span class="text-yellow-400 transition-transform group-open:rotate-180">↓</span>
                    </summary>
                    <div class="px-8 pb-8 text-zinc-400 text-sm">
                        Best experience on Chrome / Edge. Good support across modern browsers. File System Access API provides the richest local experience.
                    </div>
                </details>
            </div>
        </div>
    </section>

    <!-- FOOTER -->
    <footer class="bg-black py-16 border-t border-zinc-900">
        <div class="max-w-screen-2xl mx-auto px-8">
            <div class="flex flex-col md:flex-row justify-between items-center gap-y-8">
                <div class="flex items-center gap-x-3">
                    <div class="w-8 h-8 bg-yellow-500 rounded-2xl flex items-center justify-center text-zinc-950 font-bold">B</div>
                    <div class="heading-font text-2xl">Blend Player v5</div>
                </div>
                
                <div class="text-center md:text-right text-zinc-500 text-sm">
                    Built by <a href="https://mytech.today" target="_blank" class="hover:text-yellow-400">myTech.Today</a><br>
                    MIT Licensed • Local-first media studio
                </div>
                
                <div class="flex gap-x-6 text-2xl">
                    <a href="https://github.com/mytech-today-now/slideshow-playlist-player.html" target="_blank" class="hover:text-yellow-400 transition"><i class="fa-brands fa-github"></i></a>
                </div>
            </div>
            
            <div class="text-center text-xs text-zinc-600 mt-12">
                This documentation website is a showcase. The actual application is available at the embedded demo and GitHub repository.
            </div>
        </div>
    </footer>

    <script>
        // Tailwind script already loaded via CDN
        function initTailwind() {
            // Any additional JS if needed
        }
        
        window.onload = function() {
            initTailwind();
            
            // Make iframe responsive
            const iframe = document.getElementById('blend-iframe');
            if (iframe) {
                const resizeObserver = new ResizeObserver(() => {
                    // Optional resize handling
                });
                resizeObserver.observe(iframe.parentElement);
            }
        };
        
        // Smooth scroll for all anchor links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                if (this.getAttribute('href') !== '#') {
                    e.preventDefault();
                    const target = document.querySelector(this.getAttribute('href'));
                    if (target) target.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });
    </script>
</body>
</html>