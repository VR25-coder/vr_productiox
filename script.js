// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    
    // Initialize all functionality
    loadPortfolioContentFromJSON();

    // Listen for admin panel saving changes in another tab and auto-refresh
    window.addEventListener('storage', (event) => {
        if (event.key === 'vr_portfolio_live_data' && event.newValue) {
            window.location.reload();
        }
    });

    initSmoothScrolling();
    initProgressBars();
    initScrollAnimations();
    initCountUpStats();
    initSpotlight();
    initFormHandling();
    initMobileMenu();
    // Typewriter effect disabled to avoid hero title duplication
    // initTypewriterEffect();
    
    // Smooth scrolling for navigation links
    function initSmoothScrolling() {
        const navLinks = document.querySelectorAll('.nav-menu a[href^="#"]');
        
        navLinks.forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                
                if (target) {
                    const headerHeight = document.querySelector('.header').offsetHeight;
                    const targetPosition = target.offsetTop - headerHeight - 20;
                    
                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                    
                    // Update active nav link
                    navLinks.forEach(l => l.classList.remove('active'));
                    this.classList.add('active');
                }
            });
        });
    }
    
    // Progress bars animation
    function initProgressBars() {
        const skillBars = document.querySelectorAll('.skill-progress');
        const progressFills = document.querySelectorAll('.progress-fill');
        const techSkillBars = document.querySelectorAll('.tech-skill-progress');
        const projectFills = document.querySelectorAll('.project-fill');
        
        // Function to animate progress bars
        function animateProgressBars() {
            // Skills section progress bars
            skillBars.forEach(bar => {
                const progress = bar.getAttribute('data-progress');
                if (progress) {
                    bar.style.width = progress + '%';
                }
            });
            
            // Professional journey progress bars
            progressFills.forEach(fill => {
                const width = fill.getAttribute('data-width');
                if (width) {
                    fill.style.width = width + '%';
                }
            });
            
            // Tech skill progress bars
            techSkillBars.forEach(bar => {
                const progress = bar.getAttribute('data-progress');
                if (progress) {
                    bar.style.width = progress + '%';
                }
            });

            // Project breakdown bars
            projectFills.forEach(fill => {
                const width = fill.getAttribute('data-width');
                if (width) {
                    fill.style.width = width + '%';
                }
            });
        }
        
        // Animate when elements come into view
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    setTimeout(animateProgressBars, 500);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });
        
        // Observe progress sections
        const progressSections = document.querySelectorAll('.technical-expertise, .professional-journey, .stats-tech-section');
        progressSections.forEach(section => {
            observer.observe(section);
        });
    }
    
    // Scroll animations
    function initScrollAnimations() {
        const animationElements = document.querySelectorAll('.service-item, .project-card, .highlight-item, .stat-item');
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        });
        
        // Initially hide elements and set up animation
        animationElements.forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(30px)';
            el.style.transition = 'all 0.6s ease-out';
            observer.observe(el);
        });
        
        // Stagger animation for stat items
        const statItems = document.querySelectorAll('.stat-item');
        statItems.forEach((item, index) => {
            item.style.transitionDelay = `${index * 0.2}s`;
        });
        
        // Stagger animation for service items
        const serviceItems = document.querySelectorAll('.service-item');
        serviceItems.forEach((item, index) => {
            item.style.transitionDelay = `${index * 0.1}s`;
        });
        
        // Stagger animation for project cards
        const projectCards = document.querySelectorAll('.project-card');
        projectCards.forEach((card, index) => {
            card.style.transitionDelay = `${index * 0.1}s`;
        });
    }

    // Count-up animation for stats
    function initCountUpStats() {
        const statEls = document.querySelectorAll('.stat-number-left');
        if (!statEls.length) return;

        function parseStat(text) {
            const raw = String(text || '').trim();
            const match = raw.match(/(\d+(?:\.\d+)?)/);
            if (!match) return { value: 0, prefix: raw, suffix: '' };
            const value = parseFloat(match[1]);
            const start = match.index || 0;
            const end = start + match[1].length;
            return {
                value: isNaN(value) ? 0 : value,
                prefix: raw.slice(0, start),
                suffix: raw.slice(end)
            };
        }

        function animate(el) {
            const { value, prefix, suffix } = parseStat(el.textContent);
            const duration = 900;
            const startValue = 0;
            const startTime = performance.now();

            function tick(now) {
                const t = Math.min(1, (now - startTime) / duration);
                const eased = 1 - Math.pow(1 - t, 3);
                const current = Math.round((startValue + (value - startValue) * eased) * 10) / 10;
                el.textContent = prefix + (Number.isInteger(value) ? Math.round(current) : current) + suffix;
                if (t < 1) requestAnimationFrame(tick);
            }

            requestAnimationFrame(tick);
        }

        const seen = new WeakSet();
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !seen.has(entry.target)) {
                    seen.add(entry.target);
                    animate(entry.target);
                }
            });
        }, { threshold: 0.6 });

        statEls.forEach(el => observer.observe(el));
    }

    // Cinematic spotlight that follows the cursor
    function initSpotlight() {
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        } catch (e) {
            // ignore
        }

        const spotlight = document.querySelector('.spotlight');
        if (!spotlight) return;

        let raf = 0;
        const update = (x, y) => {
            document.documentElement.style.setProperty('--mx', x + 'px');
            document.documentElement.style.setProperty('--my', y + 'px');
        };

        const onMove = (e) => {
            const x = e.clientX;
            const y = e.clientY;
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => update(x, y));
        };

        // Set initial center
        update(window.innerWidth * 0.5, window.innerHeight * 0.35);
        window.addEventListener('mousemove', onMove, { passive: true });
    }
    
    // Form handling
    function initFormHandling() {
        const contactForm = document.querySelector('.contact-form');
        const submitBtn = document.querySelector('.submit-btn');
        
        if (contactForm) {
            contactForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                
                // Get form data
                const formData = new FormData(this);
                const formObject = {};
                formData.forEach((value, key) => {
                    formObject[key] = value;
                });
                
                // Validate form
                if (!validateForm(formObject)) {
                    showNotification('Please fill in all required fields.', 'error');
                    return;
                }

                // Show loading state
                const originalText = submitBtn.textContent;
                submitBtn.textContent = 'Sending...';
                submitBtn.disabled = true;

                    try {
                    const response = await fetch('/api/messages', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(formObject)
                    });

                    if (!response.ok) {
                        throw new Error('Server returned ' + response.status);
                    }

                    const result = await response.json().catch(() => ({}));
                    if (result && result.success) {
                        showNotification('Message sent successfully!', 'success');
                        contactForm.reset();
                    } else {
                        showNotification('Failed to send message. Please try again later.', 'error');
                    }
                } catch (error) {
                    console.error('Contact form submission failed', error);
                    showNotification('Failed to send message. Please check your connection.', 'error');
                } finally {
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            });
        }
    }
    
    // Form validation
    function validateForm(formData) {
        return formData.first_name &&
               formData.last_name &&
               formData.email && 
               formData.subject && 
               formData.message &&
               isValidEmail(formData.email);
    }
    
    // Email validation
    function isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    
    // Show notification
    function showNotification(message, type = 'info') {
        // Remove existing notification
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) {
            existingNotification.remove();
        }
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Add styles
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;
        
        // Set background color based on type
        const colors = {
            success: 'linear-gradient(135deg, #10b981, #059669)',
            error: 'linear-gradient(135deg, #ef4444, #dc2626)',
            info: 'linear-gradient(135deg, #3b82f6, #1d4ed8)'
        };
        notification.style.background = colors[type] || colors.info;
        
        // Add to page
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);
        
        // Remove after delay
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }, 4000);
    }
    
    // Mobile menu (basic implementation)
    function initMobileMenu() {
        // Create mobile menu button
        const nav = document.querySelector('.nav');
        const navMenu = document.querySelector('.nav-menu');
        
        // Create hamburger menu button
        const mobileMenuBtn = document.createElement('button');
        mobileMenuBtn.className = 'mobile-menu-btn';
        mobileMenuBtn.innerHTML = '☰';
        mobileMenuBtn.style.cssText = `
            display: none;
            background: none;
            border: none;
            color: white;
            font-size: 1.5rem;
            cursor: pointer;
            padding: 0.5rem;
        `;
        
        // Add mobile menu functionality
        let isMenuOpen = false;
        
        mobileMenuBtn.addEventListener('click', () => {
            isMenuOpen = !isMenuOpen;
            navMenu.style.display = isMenuOpen ? 'flex' : 'none';
            mobileMenuBtn.innerHTML = isMenuOpen ? '✕' : '☰';
        });
        
        // Close menu when clicking on link
        const navLinks = navMenu.querySelectorAll('a');
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    isMenuOpen = false;
                    navMenu.style.display = 'none';
                    mobileMenuBtn.innerHTML = '☰';
                }
            });
        });
        
        // Add to nav
        nav.appendChild(mobileMenuBtn);
        
        // Show/hide based on screen size
        function handleResize() {
            if (window.innerWidth <= 768) {
                mobileMenuBtn.style.display = 'block';
                navMenu.style.flexDirection = 'column';
                navMenu.style.position = 'absolute';
                navMenu.style.top = '100%';
                navMenu.style.left = '0';
                navMenu.style.right = '0';
                navMenu.style.background = 'rgba(10, 10, 10, 0.95)';
                navMenu.style.padding = '1rem';
                navMenu.style.display = isMenuOpen ? 'flex' : 'none';
            } else {
                mobileMenuBtn.style.display = 'none';
                navMenu.style.display = 'flex';
                navMenu.style.flexDirection = 'row';
                navMenu.style.position = 'static';
                navMenu.style.background = 'none';
                navMenu.style.padding = '0';
                isMenuOpen = false;
            }
        }
        
        window.addEventListener('resize', handleResize);
        handleResize(); // Initial call
    }
    
    // Typewriter effect for hero title
    function initTypewriterEffect() {
        const heroTitle = document.querySelector('.hero-title');
        if (heroTitle) {
            const originalText = heroTitle.innerHTML;
            const lines = originalText.split('<br>');
            
            // Only apply typewriter effect on larger screens
            if (window.innerWidth > 768) {
                heroTitle.innerHTML = '';
                let lineIndex = 0;
                let charIndex = 0;
                
                function typeWriter() {
                    if (lineIndex < lines.length) {
                        if (charIndex < lines[lineIndex].length) {
                            heroTitle.innerHTML += lines[lineIndex].charAt(charIndex);
                            charIndex++;
                            setTimeout(typeWriter, 100);
                        } else {
                            if (lineIndex < lines.length - 1) {
                                heroTitle.innerHTML += '<br>';
                            }
                            lineIndex++;
                            charIndex = 0;
                            setTimeout(typeWriter, 200);
                        }
                    }
                }
                
                // Start typewriter effect after a delay
                setTimeout(typeWriter, 1000);
            }
        }
    }
    
    // Navbar scroll effect
    function initNavbarScrollEffect() {
        const header = document.querySelector('.header');
        let lastScrollY = window.scrollY;
        
        window.addEventListener('scroll', () => {
            const currentScrollY = window.scrollY;
            
            if (currentScrollY > 100) {
                header.style.background = 'rgba(10, 10, 10, 0.98)';
                header.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.3)';
            } else {
                header.style.background = 'rgba(10, 10, 10, 0.95)';
                header.style.boxShadow = 'none';
            }
            
            // Hide/show navbar on scroll
            if (currentScrollY > lastScrollY && currentScrollY > 200) {
                header.style.transform = 'translateY(-100%)';
            } else {
                header.style.transform = 'translateY(0)';
            }
            
            lastScrollY = currentScrollY;
        });
    }
    
    // Initialize navbar scroll effect
    initNavbarScrollEffect();
    
    // Parallax effect for hero section
    function initParallaxEffect() {
        const hero = document.querySelector('.hero');
        
        window.addEventListener('scroll', () => {
            const scrolled = window.pageYOffset;
            const parallax = hero.querySelector('.hero-content');
            const speed = 0.1;
            
            if (parallax) {
                parallax.style.transform = `translateY(${scrolled * speed}px)`;
            }
        });
    }
    
    // Initialize parallax effect
    initParallaxEffect();
    
    // Cursor trail effect (optional, for extra visual appeal)
    function initCursorTrail() {
        if (window.innerWidth > 768) { // Only on desktop
            const cursor = document.createElement('div');
            cursor.className = 'cursor-trail';
            cursor.style.cssText = `
                position: fixed;
                width: 20px;
                height: 20px;
                background: radial-gradient(circle, rgba(124, 58, 237, 0.5) 0%, transparent 70%);
                border-radius: 50%;
                pointer-events: none;
                z-index: 9999;
                transform: translate(-50%, -50%);
                transition: all 0.1s ease;
            `;
            document.body.appendChild(cursor);
            
            document.addEventListener('mousemove', (e) => {
                cursor.style.left = e.clientX + 'px';
                cursor.style.top = e.clientY + 'px';
            });
            
            // Hide cursor trail when mouse leaves window
            document.addEventListener('mouseleave', () => {
                cursor.style.opacity = '0';
            });
            
            document.addEventListener('mouseenter', () => {
                cursor.style.opacity = '1';
            });
        }
    }
    
    // Initialize cursor trail
    initCursorTrail();
    
    // Button click effects
    function initButtonEffects() {
        const buttons = document.querySelectorAll('button, .btn-primary, .btn-secondary');
        
        buttons.forEach(button => {
            button.addEventListener('click', function(e) {
                // Create ripple effect
                const ripple = document.createElement('span');
                const rect = this.getBoundingClientRect();
                const size = Math.max(rect.width, rect.height);
                const x = e.clientX - rect.left - size / 2;
                const y = e.clientY - rect.top - size / 2;
                
                ripple.style.cssText = `
                    position: absolute;
                    width: ${size}px;
                    height: ${size}px;
                    background: rgba(255, 255, 255, 0.3);
                    border-radius: 50%;
                    left: ${x}px;
                    top: ${y}px;
                    transform: scale(0);
                    animation: ripple 0.6s ease-out;
                    pointer-events: none;
                `;
                
                this.style.position = 'relative';
                this.style.overflow = 'hidden';
                this.appendChild(ripple);
                
                setTimeout(() => {
                    ripple.remove();
                }, 600);
            });
        });
        
        // Add ripple animation to CSS
        const style = document.createElement('style');
        style.textContent = `
            @keyframes ripple {
                to {
                    transform: scale(2);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Initialize button effects
    initButtonEffects();
    
    // Loading screen (optional)
    function initLoadingScreen() {
        // Create loading screen
        const loader = document.createElement('div');
        loader.className = 'page-loader';
        loader.innerHTML = `
            <div class="loader-content">
                <div class="loader-spinner"></div>
                <p>Loading Portfolio...</p>
            </div>
        `;
        
        loader.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #0a0a0a;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            transition: opacity 0.5s ease, visibility 0.5s ease;
        `;
        
        const loaderContent = loader.querySelector('.loader-content');
        loaderContent.style.cssText = `
            text-align: center;
            color: white;
        `;
        
        const spinner = loader.querySelector('.loader-spinner');
        spinner.style.cssText = `
            width: 50px;
            height: 50px;
            border: 3px solid rgba(124, 58, 237, 0.3);
            border-top: 3px solid #7c3aed;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        `;
        
        // Add spinner animation
        const spinnerStyle = document.createElement('style');
        spinnerStyle.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(spinnerStyle);
        
        document.body.appendChild(loader);
        
        // Hide loader when page is loaded
        window.addEventListener('load', () => {
            setTimeout(() => {
                loader.style.opacity = '0';
                loader.style.visibility = 'hidden';
                setTimeout(() => {
                    loader.remove();
                }, 500);
            }, 1000);
        });
    }
    
    // Initialize loading screen
    initLoadingScreen();
    
    // Add scroll to top button
    function initScrollToTop() {
        const scrollBtn = document.createElement('button');
        scrollBtn.innerHTML = '↑';
        scrollBtn.className = 'scroll-to-top';
        scrollBtn.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 50px;
            height: 50px;
            background: linear-gradient(135deg, #7c3aed, #3b82f6);
            color: white;
            border: none;
            border-radius: 50%;
            font-size: 1.5rem;
            cursor: pointer;
            opacity: 0;
            visibility: hidden;
            transition: all 0.3s ease;
            z-index: 1000;
            box-shadow: 0 4px 20px rgba(124, 58, 237, 0.3);
        `;
        
        document.body.appendChild(scrollBtn);
        
        // Show/hide based on scroll position
        window.addEventListener('scroll', () => {
            if (window.pageYOffset > 300) {
                scrollBtn.style.opacity = '1';
                scrollBtn.style.visibility = 'visible';
            } else {
                scrollBtn.style.opacity = '0';
                scrollBtn.style.visibility = 'hidden';
            }
        });
        
        // Scroll to top on click
        scrollBtn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
        
        // Hover effect
        scrollBtn.addEventListener('mouseenter', () => {
            scrollBtn.style.transform = 'translateY(-3px) scale(1.1)';
            scrollBtn.style.boxShadow = '0 8px 25px rgba(124, 58, 237, 0.4)';
        });
        
        scrollBtn.addEventListener('mouseleave', () => {
            scrollBtn.style.transform = 'translateY(0) scale(1)';
            scrollBtn.style.boxShadow = '0 4px 20px rgba(124, 58, 237, 0.3)';
        });
    }
    
    // Initialize scroll to top
    initScrollToTop();

    // Auto-fill helper for LinkedIn JSON (local file)
    function initLinkedInAutoFill() {
        fetch('linkedin_data.json')
            .then(res => {
                if (!res.ok) throw new Error('no-linkedin-json');
                return res.json();
            })
            .then(data => {
                try {
                    // Current Position
                    if (data.currentPosition) {
                        const role = document.querySelector('.current-position .role');
                        const company = document.querySelector('.current-position .company');
                        const duration = document.querySelector('.current-position .duration');
                        const location = document.querySelector('.current-position .location');
                        if (role && data.currentPosition.role) role.textContent = data.currentPosition.role;
                        if (company && data.currentPosition.company) company.textContent = data.currentPosition.company;
                        if (duration && data.currentPosition.duration) duration.textContent = data.currentPosition.duration;
                        if (location && data.currentPosition.location) location.textContent = data.currentPosition.location;
                    }
                    // Career Journey timeline
                    if (Array.isArray(data.career) && data.career.length) {
                        const timeline = document.querySelector('.career-journey .timeline-list');
                        if (timeline) {
                            timeline.innerHTML = '';
                            data.career.forEach(entry => {
                                const div = document.createElement('div');
                                div.className = 'timeline-entry';
                                div.innerHTML = `<span class="timeline-text"></span>`;
                                div.querySelector('.timeline-text').textContent = entry;
                                timeline.appendChild(div);
                            });
                        }
                    }
                } catch (e) {
                    console.warn('LinkedIn auto-fill parse error', e);
                }
            })
            .catch(() => {
                // Silent if file not present
            });
    }
    
    console.log('Portfolio website loaded successfully!');
});

// Resume download function
function downloadResume() {
    // Make sure this file exists in the same folder as index.html
    const fileName = 'VRUTANT-RATNAPURE-FlowCV-Resume-20251117[1].pdf';
    const link = document.createElement('a');
    link.href = fileName;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Hospital video player function
function playHospitalVideo(fileName) {
    // Create video modal
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        cursor: pointer;
    `;
    
    const video = document.createElement('video');
    const src = fileName || 'lv_0_20250921131544.mp4';
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    video.style.cssText = `
        max-width: 90%;
        max-height: 90%;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    `;
    
    // Close modal when clicking outside video
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
    
    // Close modal with escape key
    const closeOnEscape = (e) => {
        if (e.key === 'Escape') {
            document.body.removeChild(modal);
            document.removeEventListener('keydown', closeOnEscape);
        }
    };
    document.addEventListener('keydown', closeOnEscape);
    
    modal.appendChild(video);
    document.body.appendChild(modal);
}

// Load portfolio content from JSON and apply to the public site
async function loadPortfolioContentFromJSON() {
    try {
        const response = await fetch('portfolio_data.json?' + Date.now());
        if (!response.ok) throw new Error('Failed to load portfolio data');
        const data = await response.json();

        // Apply optional theme colors from JSON (used for navbar and global colors)
        if (data.theme) {
            const rootStyle = document.documentElement.style;
            if (data.theme.primary) rootStyle.setProperty('--accent-color', data.theme.primary);
            if (data.theme.secondary) rootStyle.setProperty('--accent-color-secondary', data.theme.secondary);
            if (data.theme.background) rootStyle.setProperty('--background-color', data.theme.background);
            if (data.theme.text) rootStyle.setProperty('--text-color', data.theme.text);
        }

        // Navigation
        if (data.navigation) {
            const brandEl = document.querySelector('.nav-brand h1');
            if (brandEl) {
                const brand = data.navigation.brand || 'Vrutant';
                const subtitle = data.navigation.subtitle || 'Video Editor';
                brandEl.innerHTML = `${brand} <span class="nav-subtitle">${subtitle}</span>`;
            }
            const navMenu = document.querySelector('.nav-menu');
            if (navMenu && Array.isArray(data.navigation.menu) && data.navigation.menu.length) {
                navMenu.innerHTML = '';
                data.navigation.menu.forEach(item => {
                    const li = document.createElement('li');
                    const a = document.createElement('a');
                    a.textContent = item.label || '';
                    a.href = item.href || '#';
                    li.appendChild(a);
                    navMenu.appendChild(li);
                });
            }
        }

        // Personal / hero text
        if (data.personal) {
            const availability = document.querySelector('.availability-status span');
            if (availability && data.personal.availability) {
                availability.textContent = data.personal.availability;
            }

            const heroTitle = document.querySelector('.hero-title');
            if (heroTitle && data.personal.title) {
                heroTitle.innerHTML = data.personal.title.replace(/\n/g, '<br>');
            }

            const heroDescription = document.querySelector('.hero-description');
            if (heroDescription && data.personal.description) {
                heroDescription.textContent = data.personal.description;
            }
        }

        // Hero buttons and image
        if (data.hero) {
            const primaryBtn = document.querySelector('.btn-primary');
            if (primaryBtn && data.hero.buttons && data.hero.buttons.primary) {
                primaryBtn.innerHTML = '<span class="play-icon">▶</span> ' + data.hero.buttons.primary.text;
                primaryBtn.onclick = () => window.open(data.hero.buttons.primary.link, '_blank');
            }

            const secondaryBtn = document.querySelector('.btn-secondary');
            if (secondaryBtn && data.hero.buttons && data.hero.buttons.secondary) {
                secondaryBtn.innerHTML = '<span class="download-icon">⬇</span> ' + data.hero.buttons.secondary.text;
                secondaryBtn.onclick = () => window.open(data.hero.buttons.secondary.file, '_blank');
            }

            const heroPlaceholder = document.querySelector('.hero-video-placeholder');
            if (heroPlaceholder && data.hero.image) {
                heroPlaceholder.style.backgroundImage = `url(${data.hero.image})`;
                heroPlaceholder.style.backgroundSize = 'cover';
                heroPlaceholder.style.backgroundPosition = 'center';
            }
        }

        // Stats
        if (data.stats) {
            const statNumbers = document.querySelectorAll('.stat-number-left');
            if (statNumbers.length >= 4) {
                if (data.stats.projects) statNumbers[0].textContent = data.stats.projects;
                if (data.stats.experience) statNumbers[1].textContent = data.stats.experience;
                if (data.stats.clients) statNumbers[2].textContent = data.stats.clients;
                if (data.stats.awards) statNumbers[3].textContent = data.stats.awards;
            }
        }

        // Technical skills grid
        if (Array.isArray(data.skills)) {
            const techSkillItems = document.querySelectorAll('.tech-skill-item');
            techSkillItems.forEach((item, index) => {
                const skill = data.skills[index];
                if (!skill) return;
                const nameEl = item.querySelector('.tech-skill-name');
                const percentEl = item.querySelector('.tech-skill-percentage');
                const barEl = item.querySelector('.tech-skill-progress');
                if (nameEl) nameEl.textContent = skill.name;
                if (percentEl) percentEl.textContent = `${skill.percentage}%`;
                if (barEl) barEl.setAttribute('data-progress', skill.percentage);
            });
        }

        // About section
        if (data.about) {
            const aboutTitle = document.querySelector('.about-title');
            const aboutIntro = document.querySelector('.about-intro');
            const aboutDescription = document.querySelector('.about-description');
            if (aboutTitle && data.about.title) aboutTitle.textContent = data.about.title;
            if (aboutIntro && data.about.intro) aboutIntro.textContent = data.about.intro;
            if (aboutDescription && data.about.description) aboutDescription.textContent = data.about.description;

            const skillTagsContainer = document.querySelector('.skill-tags');
            if (skillTagsContainer && Array.isArray(data.about.skills)) {
                skillTagsContainer.innerHTML = '';
                data.about.skills.forEach(tag => {
                    const span = document.createElement('span');
                    span.className = 'skill-tag';
                    span.textContent = tag;
                    skillTagsContainer.appendChild(span);
                });
            }

            const mainImage = document.querySelector('.about-image-main');
            const smallImage = document.querySelector('.about-image-small');
            if (mainImage && data.about.mainImage) {
                mainImage.style.backgroundImage = `url(${data.about.mainImage})`;
            }
            if (smallImage && data.about.smallImage) {
                smallImage.style.backgroundImage = `url(${data.about.smallImage})`;
            }
        }

        // Experience section heading
        if (data.experienceSection) {
            const jTitle = document.querySelector('.journey-title');
            const jSubtitle = document.querySelector('.journey-subtitle');
            if (jTitle && data.experienceSection.title) jTitle.textContent = data.experienceSection.title;
            if (jSubtitle && data.experienceSection.subtitle) jSubtitle.textContent = data.experienceSection.subtitle;
        }

        // Current position & professional journey
        if (data.currentPosition) {
            const roleEl = document.querySelector('.current-position .role');
            const companyEl = document.querySelector('.current-position .company');
            const durationEl = document.querySelector('.current-position .duration');
            const locationEl = document.querySelector('.current-position .location');
            if (roleEl && data.currentPosition.role) roleEl.textContent = data.currentPosition.role;
            if (companyEl && data.currentPosition.company) companyEl.textContent = data.currentPosition.company;
            if (durationEl && data.currentPosition.duration) durationEl.textContent = data.currentPosition.duration;
            if (locationEl && data.currentPosition.location) locationEl.textContent = data.currentPosition.location;

            const tagsContainer = document.querySelector('.current-position .position-tags');
            if (tagsContainer && Array.isArray(data.currentPosition.tags)) {
                tagsContainer.innerHTML = '';
                data.currentPosition.tags.forEach(tag => {
                    const span = document.createElement('span');
                    span.className = 'position-tag';
                    span.textContent = tag;
                    tagsContainer.appendChild(span);
                });
            }

            const topSkillsContainer = document.querySelector('.current-position .top-skills');
            if (topSkillsContainer && Array.isArray(data.currentPosition.topSkills)) {
                topSkillsContainer.innerHTML = '';
                const title = document.createElement('h4');
                title.className = 'skills-title';
                title.textContent = 'Top Skills';
                topSkillsContainer.appendChild(title);
                data.currentPosition.topSkills.forEach(skill => {
                    const item = document.createElement('div');
                    item.className = 'skill-bar-item';
                    item.innerHTML = `
                        <span class="skill-name">${skill.name} — ${skill.percentage}%</span>
                        <div class="skill-bar">
                            <div class="skill-progress" data-progress="${skill.percentage}"></div>
                        </div>
                    `;
                    topSkillsContainer.appendChild(item);
                });
            }
        }

        // Metrics
        if (data.metrics) {
            const metricTexts = document.querySelectorAll('.key-metrics .metric-text');
            if (metricTexts.length >= 3) {
                if (data.metrics.projects) metricTexts[0].textContent = data.metrics.projects;
                if (data.metrics.clients) metricTexts[1].textContent = data.metrics.clients;
                if (data.metrics.awards) metricTexts[2].textContent = data.metrics.awards;
            }
        }

        // Career timeline
        if (Array.isArray(data.career)) {
            const timeline = document.querySelector('.career-journey .timeline-list');
            if (timeline) {
                timeline.innerHTML = '';
                data.career.forEach(entry => {
                    const div = document.createElement('div');
                    div.className = 'timeline-entry';
                    const span = document.createElement('span');
                    span.className = 'timeline-text';
                    span.textContent = entry;
                    div.appendChild(span);
                    timeline.appendChild(div);
                });
            }
        }

        // Tech stack
        if (Array.isArray(data.techStack)) {
            const techGrid = document.querySelector('.tech-stack .tech-tools-grid');
            if (techGrid) {
                techGrid.innerHTML = '';
                data.techStack.forEach(tool => {
                    const div = document.createElement('div');
                    div.className = 'tech-tool';
                    const span = document.createElement('span');
                    span.className = 'tech-tool-name';
                    span.textContent = tool;
                    div.appendChild(span);
                    techGrid.appendChild(div);
                });
            }
        }

        // Recognition
        if (Array.isArray(data.recognition)) {
            const list = document.querySelector('.latest-recognition .recognition-list');
            if (list) {
                list.innerHTML = '';
                data.recognition.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'recognition-item';
                    div.innerHTML = `
                        <div class="recognition-icon">${item.icon}</div>
                        <div class="recognition-content">
                            <h4 class="recognition-title">${item.title}</h4>
                            <p class="recognition-event">${item.event}</p>
                        </div>
                    `;
                    list.appendChild(div);
                });
            }
        }

        // Testimonials
        if (Array.isArray(data.testimonials)) {
            const cards = document.querySelectorAll('.testimonial-card');
            cards.forEach((card, index) => {
                const testimonial = data.testimonials[index];
                if (!testimonial) return;
                const textEl = card.querySelector('.testimonial-text');
                const authorEl = card.querySelector('.testimonial-author');
                if (textEl) textEl.textContent = testimonial.quote;
                if (authorEl) authorEl.textContent = `– ${testimonial.author}`;
            });
        }

        // Project breakdown card
        if (Array.isArray(data.projectBreakdown)) {
            const items = document.querySelectorAll('.project-breakdown .project-bar-item');
            items.forEach((wrap, index) => {
                const item = data.projectBreakdown[index];
                if (!item) return;
                const nameEl = wrap.querySelector('.project-name');
                const countEl = wrap.querySelector('.project-count');
                const fillEl = wrap.querySelector('.project-fill');
                if (nameEl && item.name) nameEl.textContent = item.name;
                if (countEl && item.countText) countEl.textContent = item.countText;
                if (fillEl && typeof item.percentage === 'number') {
                    fillEl.setAttribute('data-width', item.percentage);
                }
            });
        }

        // Projects gallery (cards are generated from JSON, unlimited count)
        if (Array.isArray(data.projects)) {
            const grid = document.querySelector('.projects-grid');
            if (grid) {
                grid.innerHTML = '';
                data.projects.forEach(project => {
                    const card = document.createElement('div');
                    card.className = 'project-card';

                    const thumb = document.createElement('div');
                    thumb.className = 'project-thumbnail';
                    const playButton = document.createElement('div');
                    playButton.className = 'play-button';
                    playButton.innerHTML = '<span>▶</span>';
                    thumb.appendChild(playButton);

                    const info = document.createElement('div');
                    info.className = 'project-info';
                    info.innerHTML = `
                        <h4 class="project-title"></h4>
                        <p class="project-description"></p>
                        <div class="project-stats">
                            <div class="stat">
                                <span class="stat-icon">👁</span>
                                <span></span>
                            </div>
                            <div class="stat">
                                <span class="stat-icon">💖</span>
                                <span></span>
                            </div>
                        </div>
                    `;

                    const titleEl = info.querySelector('.project-title');
                    const descEl = info.querySelector('.project-description');
                    const statSpans = info.querySelectorAll('.project-stats .stat span:last-child');
                    if (titleEl) titleEl.textContent = project.title || '';
                    if (descEl) descEl.textContent = project.description || '';
                    if (statSpans.length >= 2) {
                        statSpans[0].textContent = project.views || '';
                        statSpans[1].textContent = project.engagement || '';
                    }

                    if (project.thumbnail) {
                        const t = String(project.thumbnail).trim();
                        // Always try to use thumbnail as an image URL.
                        // Note: if you paste a non-image page URL (e.g. Instagram post link), it may not load.
                        if (t) {
                            thumb.style.backgroundImage = `url(${t})`;
                            thumb.style.backgroundSize = 'cover';
                            thumb.style.backgroundPosition = 'center';
                            thumb.style.backgroundRepeat = 'no-repeat';
                        }
                    }

                    const type = project.type || 'link';
                    const link = project.link || '';
                    const videoFile = project.videoFile || '';

                    const clickHandler = () => {
                        if (type === 'video' && videoFile) {
                            playHospitalVideo(videoFile);
                        } else if (type === 'link' && link) {
                            window.open(link, '_blank');
                        }
                    };
                    thumb.addEventListener('click', clickHandler);

                    card.appendChild(thumb);
                    card.appendChild(info);
                    grid.appendChild(card);
                });
            }
        }

        // Projects section heading
        if (data.projectsSection) {
            const pTitle = document.querySelector('.projects-title');
            const pSubtitle = document.querySelector('.projects-subtitle');
            if (pTitle && data.projectsSection.title) pTitle.textContent = data.projectsSection.title;
            if (pSubtitle && data.projectsSection.subtitle) pSubtitle.textContent = data.projectsSection.subtitle;
        }

        // Contact section
        if (data.contact) {
            const titleEl = document.querySelector('.contact-title');
            const subtitleEl = document.querySelector('.contact-subtitle');
            if (titleEl && data.contact.title) titleEl.textContent = data.contact.title;
            if (subtitleEl && data.contact.subtitle) subtitleEl.textContent = data.contact.subtitle;

            const infoHeadingEl = document.querySelector('.contact-info h3');
            const infoBodyEl = document.querySelector('.contact-info > p');
            const socialHeadingEl = document.querySelector('.social-heading');
            if (infoHeadingEl && data.contact.infoHeading) infoHeadingEl.textContent = data.contact.infoHeading;
            if (infoBodyEl && data.contact.infoBody) infoBodyEl.textContent = data.contact.infoBody;
            if (socialHeadingEl && data.contact.socialHeading) socialHeadingEl.textContent = data.contact.socialHeading;

            const detailValues = document.querySelectorAll('.contact-details .contact-value');
            if (detailValues.length >= 3 && data.contact.details) {
                if (data.contact.details.email) detailValues[0].textContent = data.contact.details.email;
                if (data.contact.details.phone) detailValues[1].textContent = data.contact.details.phone;
                if (data.contact.details.location) detailValues[2].textContent = data.contact.details.location;
            }

            const socialLinks = document.querySelectorAll('.social-links a');
            if (data.contact.social && socialLinks.length >= 3) {
                if (data.contact.social.linkedin) socialLinks[0].href = data.contact.social.linkedin;
                if (data.contact.social.instagram) socialLinks[1].href = data.contact.social.instagram;
                if (data.contact.social.facebook) socialLinks[2].href = data.contact.social.facebook;
            }
        }

        // Services row cards
        if (Array.isArray(data.servicesRow)) {
            const serviceCards = document.querySelectorAll('.services-row .service-item-inline');
            serviceCards.forEach((card, index) => {
                const svc = data.servicesRow[index];
                if (!svc) return;
                const iconEl = card.querySelector('.service-icon-inline');
                const titleEl = card.querySelector('.service-title-inline');
                const descEl = card.querySelector('.service-desc-inline');
                if (iconEl && svc.icon) iconEl.textContent = svc.icon;
                if (titleEl && svc.title) titleEl.textContent = svc.title;
                if (descEl && svc.description) descEl.textContent = svc.description;

                card.onclick = null;
                if (svc.type === 'video' && svc.videoFile) {
                    card.addEventListener('click', () => playHospitalVideo(svc.videoFile));
                } else if (svc.type === 'link' && svc.link) {
                    card.addEventListener('click', () => window.open(svc.link, '_blank'));
                }
            });
        }

        // Footer
        if (data.footer) {
            const nameEl = document.querySelector('.footer-left h3');
            const roleEl = document.querySelector('.footer-left p');
            const copyEl = document.querySelector('.footer-right p');
            if (nameEl && data.footer.name) nameEl.textContent = data.footer.name;
            if (roleEl && data.footer.role) roleEl.textContent = data.footer.role;
            if (copyEl && data.footer.copyright) copyEl.textContent = data.footer.copyright;
        }

    } catch (error) {
        console.error('Failed to load portfolio_data.json', error);
    }
}
