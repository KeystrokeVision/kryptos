// Boot sequence for the KRYPTOS splash window — pure vanilla JS (no bundler
// here, splashscreen.html is its own tiny page) served as a same-origin file
// so it works under the strict "default-src 'self'" CSP without needing an
// 'unsafe-inline' script exception.
(function () {
  var canvas = document.getElementById("rain");
  var ctx = canvas.getContext("2d");
  var panel = document.querySelector(".panel");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    canvas.width = panel.clientWidth;
    canvas.height = panel.clientHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  var GLYPHS = "01ABCDEF#$%&*+-/\\<>{}[]?!:;アイウエオカキクケコサシスセソ".split("");
  var fontSize = 14;
  var rainTimer = null;

  if (!reduceMotion) {
    var columns = Math.ceil(canvas.width / fontSize);
    var drops = new Array(columns).fill(0).map(function () {
      return Math.random() * -40;
    });

    var drawRain = function () {
      ctx.fillStyle = "rgba(5, 5, 5, 0.16)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = fontSize + "px 'JetBrains Mono', monospace";
      for (var i = 0; i < drops.length; i++) {
        var glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        var x = i * fontSize;
        var y = drops[i] * fontSize;
        var atHead = Math.random() > 0.94;
        ctx.fillStyle = atHead ? "rgba(255, 235, 235, 0.9)" : "rgba(255, 59, 59, " + (0.25 + Math.random() * 0.4) + ")";
        ctx.fillText(glyph, x, y);
        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] += 0.55 + Math.random() * 0.35;
      }
    };
    rainTimer = setInterval(drawRain, 45);
  }

  var LOG_LINES = [
    "iniciando kryptos_core...",
    "verificando integridad del sistema... OK",
    "cargando modulo sentinel...",
    "estableciendo canal cifrado local...",
    "listo.",
  ];
  var logEl = document.getElementById("boot-log");
  var lineIndex = 0;

  function nextLine() {
    if (lineIndex >= LOG_LINES.length) {
      var wordmark = document.querySelector(".wordmark");
      if (wordmark) wordmark.classList.add("show");
      return;
    }
    var line = document.createElement("div");
    line.className = "boot-line";
    line.textContent = "> " + LOG_LINES[lineIndex];
    logEl.appendChild(line);
    lineIndex++;
    setTimeout(nextLine, reduceMotion ? 40 : 430);
  }
  setTimeout(nextLine, reduceMotion ? 0 : 450);

  setTimeout(
    function () {
      document.body.classList.add("fade-out");
    },
    reduceMotion ? 400 : 3100
  );

  window.addEventListener("beforeunload", function () {
    if (rainTimer) clearInterval(rainTimer);
  });
})();
