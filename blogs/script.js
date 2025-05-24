document.addEventListener('DOMContentLoaded', function() {
    // Toggle verse translations and commentary
    const verses = document.querySelectorAll('.sanskrit-verse');
    verses.forEach(verse => {
        verse.addEventListener('click', function() {
            const verseContainer = this.closest('.verse');
            const translation = verseContainer.querySelector('.translation');
            const commentary = verseContainer.querySelector('.commentary');
            const transliteration = verseContainer.querySelector('.trans');
            
            if (translation) translation.classList.toggle('hidden');
            if (commentary) commentary.classList.toggle('hidden');
            if (transliteration) transliteration.classList.toggle('hidden');
        });
    });

    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Expand all verses button functionality
    const expandAllBtn = document.getElementById('expand-all');
    if (expandAllBtn) {
        let expanded = false;
        expandAllBtn.addEventListener('click', function() {
            const hiddenElements = document.querySelectorAll('.hidden');
            hiddenElements.forEach(el => {
                el.classList.toggle('hidden');
                el.classList.toggle('show');
            });
            expanded = !expanded;
            this.textContent = expanded ? 'Collapse All' : 'Expand All';
        });
    }

    // Mobile menu toggle
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('nav ul');
    if (menuToggle && nav) {
        menuToggle.addEventListener('click', function() {
            nav.classList.toggle('show');
        });
    }
});