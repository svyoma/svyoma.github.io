var addStyle = function(styleName) {
    var head = document.getElementsByTagName('head')[0];
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = styleName;
    head.appendChild(link);
}

// Use the function to load the desired CSS file(s)
var currentUrl = window.location.href;

if (currentUrl.indexOf("/projects/") > -1) {
    addStyle('/projects/styles1.css');
} else {
    addStyle('/styles2.css');
}