const verseList = document.querySelector(".verse-list");
const verses = verseList.querySelectorAll(".verse");
const expandAllButton = document.getElementById("expand-all");

// Function to toggle a single verse
function toggleVerse(verse) {
  const verseTitle = verse.querySelector(".sanskrit-verse");
  const translation = verse.querySelector(".translation");
  const commentary = verse.querySelector(".commentary");
  const transliteration = verse.querySelector(".trans")
  const precomm = verse.querySelector(".precomm")

  verse.classList.toggle("active");
  translation.classList.toggle("hidden");
  commentary.classList.toggle("hidden");
  transliteration.classList.toggle("hidden")
  precomm.classList.toggle("hidden")

  // Update button text based on the current state
  const isExpanded = translation.classList.contains("hidden");
  expandAllButton.textContent = isExpanded ? "Expand All" : "Collapse All";
}

// Add click event listener to each verse title
verses.forEach(verse => {
  const verseTitle = verse.querySelector(".sanskrit-verse");
  verseTitle.addEventListener("click", function() {
    toggleVerse(verse);
  });
});

// Add click event listener to the "Expand All" button
expandAllButton.addEventListener("click", function() {
  verses.forEach(verse => {
    toggleVerse(verse);
  });
});

// Initial check to update button text based on default visibility
const hiddenTranslations = verseList.querySelectorAll(".translation.hidden");
expandAllButton.textContent = hiddenTranslations.length > 0 ? "Expand All" : "Collapse All";