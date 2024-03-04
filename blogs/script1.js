document.addEventListener('DOMContentLoaded', function () {
    const headingList = document.getElementById('heading-list');

    // Get all headings from the content area
    const headings = document.querySelectorAll('#content h2');

    headings.forEach(function (heading, index) {
        // Create a list item for each heading in the sidebar
        const listItem = document.createElement('li');
        const link = document.createElement('a');
        link.href = '#blog-post-' + (index + 1) + '-heading-' + index; // Create unique links for each heading
        link.textContent = heading.textContent;
        listItem.appendChild(link);

        // Append nested list for subheadings (if any)
        const subheadings = heading.parentNode.querySelectorAll('h3');
        if (subheadings.length > 0) {
            const subList = document.createElement('ul');
            subheadings.forEach(function (subheading, subIndex) {
                const subListItem = document.createElement('li');
                const subLink = document.createElement('a');
                subLink.href = '#blog-post-' + (index + 1) + '-subheading-' + subIndex;
                subLink.textContent = subheading.textContent;
                subListItem.appendChild(subLink);
                subList.appendChild(subListItem);

                // Add an id to each subheading for easy navigation
                subheading.id = 'blog-post-' + (index + 1) + '-subheading-' + subIndex;
            });
            listItem.appendChild(subList);
        }

        headingList.appendChild(listItem);

        // Add an id to each heading for easy navigation
        heading.id = 'blog-post-' + (index + 1) + '-heading-' + index;
    });
});
