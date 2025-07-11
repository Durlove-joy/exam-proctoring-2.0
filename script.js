// --- Screen Share Detection & Notification ---
// --- Enhanced Screen Share & Display Duplication Detection ---
function detectScreenShare() {
  if (!navigator.mediaDevices) return;

  // Helper: Check for multiple displays (hardware/projector/duplicate screen)
  async function checkMultipleDisplays() {
    try {
      // Try to use the Screen Enumeration API (if available)
      if (navigator.getScreens) {
        const screens = await navigator.getScreens();
        if (screens && screens.screens && screens.screens.length > 1) {
          showShortAlert(`Multiple screens detected! Please disconnect projectors/extra monitors. (${getCurrentExamTime()})`);
          recordScreenShareViolation('hardware_duplicate');
        }
      } else if (window.screen && window.screen.width && window.screen.availWidth) {
        // Fallback: Compare available width/height to screen width/height
        if (window.screen.availWidth > window.screen.width + 10 || window.screen.availHeight > window.screen.height + 10) {
          showShortAlert(`Possible screen duplication detected! (${getCurrentExamTime()})`);
          recordScreenShareViolation('hardware_duplicate');
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }

  // Helper: Check for software-based screen sharing (getDisplayMedia, enumerateDevices)
  async function checkSoftwareScreenShare() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      // Look for display media or virtual video devices
      const suspicious = devices.some(device =>
        (device.kind === 'videoinput' && /screen|virtual|display|capture|obs|ndi|vdo.ninja|remote|teams|zoom|meet|skype|webex|anydesk|splashtop|vnc|rdp/i.test(device.label))
      );
      if (suspicious) {
        showShortAlert(`Suspicious video device (screen share/virtual camera) detected! (${getCurrentExamTime()})`);
        recordScreenShareViolation('software_share');
      }
    } catch (e) {
      // Ignore errors
    }
  }

  // Helper: Check for video call/remote desktop activity (extra audio/video devices, known labels, and Google Meet/Teams/Zoom tab sharing)
  async function checkVideoCallOrRemoteDesktop() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      // Look for multiple audiooutput or videoinput devices with highly suspicious labels (stricter, less false positives)
      const videoCallLike = devices.some(device =>
        (device.kind === 'audiooutput' && /virtual|remote|teams|zoom|skype|webex|anydesk|splashtop|vnc|rdp/i.test(device.label)) ||
        (device.kind === 'videoinput' && /teams|zoom|skype|webex|anydesk|splashtop|vnc|rdp|obs|ndi|vdo.ninja/i.test(device.label))
      );
      // Only flag tab sharing if a video call device is present and tab is not focused, or if the title/referrer is a known video call platform
      let tabShareDetected = false;
      // Try to detect if the document title or referrer contains known video call platforms (for Google Meet, Zoom, etc.)
      const title = document.title.toLowerCase();
      const referrer = document.referrer.toLowerCase();
      const url = window.location.href.toLowerCase();
      const videoCallKeywords = ['meet', 'zoom', 'teams', 'skype', 'webex', 'discord', 'google meet', 'microsoft teams'];
      if (videoCallKeywords.some(k => title.includes(k) || referrer.includes(k) || url.includes(k))) {
        tabShareDetected = true;
      }
      // If getDisplayMedia is in use (screen sharing API), flag as screen share
      if (navigator.mediaDevices.getDisplayMedia && navigator.mediaDevices._screenShareActive) {
        tabShareDetected = true;
      }
      if (videoCallLike || tabShareDetected) {
        showShortAlert(`Possible video call, remote desktop, or tab sharing detected! (${getCurrentExamTime()})`);
        recordScreenShareViolation('video_call_or_tab_share');
      }
    } catch (e) {
      // Ignore errors
    }
  }

  // Record violation in monitoringData
  function recordScreenShareViolation(type) {
    const currentTime = Date.now();
    monitoringData.violationTypes.screen_share = (monitoringData.violationTypes.screen_share || 0) + 1;
    monitoringData.totalViolations++;
    monitoringData.suspiciousEvents.push({
      timestamp: currentTime,
      violation: {
        type: 'screen_share',
        severity: 'high',
        message: `Screen sharing/duplication detected (${type})`
      },
      violationNumber: monitoringData.totalViolations
    });
    monitoringData.lastAlertTime = currentTime;
    updateViolationDisplay();
  }


  // Listen for device changes (new display, projector, virtual device, etc.)
  navigator.mediaDevices.ondevicechange = async function() {
    await checkMultipleDisplays();
    await checkSoftwareScreenShare();
    await checkVideoCallOrRemoteDesktop();
  };

  // --- Enhanced: Detect if user switches to/from a video call tab (Meet/Zoom/Teams/Discord/etc) ---
  let lastTabTitle = document.title;
  let lastTabUrl = window.location.href;
  let lastTabHiddenTime = null;
  let lastTabWasVideoCall = false;
  const videoCallKeywords = ['meet', 'zoom', 'teams', 'skype', 'webex', 'discord', 'google meet', 'microsoft teams'];

  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      // Tab is being hidden (user switched away)
      lastTabTitle = document.title.toLowerCase();
      lastTabUrl = window.location.href.toLowerCase();
      lastTabHiddenTime = Date.now();
      lastTabWasVideoCall = videoCallKeywords.some(k => lastTabTitle.includes(k) || lastTabUrl.includes(k));
    } else {
      // Tab is visible again (user switched back)
      const currentTitle = document.title.toLowerCase();
      const currentUrl = window.location.href.toLowerCase();
      const now = Date.now();
      // If the previous tab was a video call, or the current tab is a video call, flag as suspicious
      const nowIsVideoCall = videoCallKeywords.some(k => currentTitle.includes(k) || currentUrl.includes(k));
      if ((lastTabWasVideoCall || nowIsVideoCall) && lastTabHiddenTime && (now - lastTabHiddenTime > 1000)) {
        showShortAlert(`Possible tab switch to/from video call platform detected! (${getCurrentExamTime()})`);
        recordScreenShareViolation('tab_switch_video_call');
      }
      // Reset
      lastTabHiddenTime = null;
      lastTabWasVideoCall = false;
    }
  });

  // Patch getDisplayMedia to detect screen sharing start
  if (navigator.mediaDevices.getDisplayMedia) {
    const origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
    navigator.mediaDevices._screenShareActive = false;
    navigator.mediaDevices.getDisplayMedia = async function(...args) {
      navigator.mediaDevices._screenShareActive = true;
      showShortAlert(`Screen sharing started! (${getCurrentExamTime()})`);
      recordScreenShareViolation('getDisplayMedia');
      try {
        const stream = await origGetDisplayMedia.apply(this, args);
        // Listen for screen share stop
        if (stream && stream.getTracks) {
          stream.getTracks().forEach(track => {
            track.addEventListener('ended', () => {
              navigator.mediaDevices._screenShareActive = false;
            });
          });
        }
        return stream;
      } catch (e) {
        navigator.mediaDevices._screenShareActive = false;
        throw e;
      }
    };
  }

  // Initial checks at exam start
  setTimeout(async () => {
    await checkMultipleDisplays();
    await checkSoftwareScreenShare();
    await checkVideoCallOrRemoteDesktop();
  }, 1000);
}
// --- Voice Detection Alert (Web Audio API) ---
// --- Anti-Cheating: Clipboard, Context Menu, Shortcut Blocking, Fullscreen Enforcement, Randomized Questions ---
function enableAntiCheatFeatures() {
  // Clipboard Monitoring: Prevent copy, cut, paste
  document.addEventListener('copy', function(e) {
    e.preventDefault();
    showShortAlert('Copying is disabled during the exam!');
    logCheatViolation('clipboard_copy');
  });
  document.addEventListener('cut', function(e) {
    e.preventDefault();
    showShortAlert('Cutting is disabled during the exam!');
    logCheatViolation('clipboard_cut');
  });
  document.addEventListener('paste', function(e) {
    e.preventDefault();
    showShortAlert('Pasting is disabled during the exam!');
    logCheatViolation('clipboard_paste');
  });

  // Context Menu Blocking: Disable right-click
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    showShortAlert('Right-click is disabled during the exam!');
    logCheatViolation('context_menu');
  });

  // Keyboard Shortcut Blocking
  document.addEventListener('keydown', function(e) {
    // Block PrintScreen, Ctrl+Shift+I, Ctrl+Shift+C, Ctrl+U, Ctrl+T, Ctrl+N, Ctrl+W, F12, Alt+Tab, Ctrl+Tab, etc.
    const forbidden = (
      (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'C' || e.key === 'J')) ||
      (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.key === 'T' || e.key === 't' || e.key === 'N' || e.key === 'n' || e.key === 'W' || e.key === 'w')) ||
      (e.key === 'F12') ||
      (e.key === 'PrintScreen') ||
      (e.altKey && (e.key === 'Tab')) ||
      (e.ctrlKey && e.key === 'Tab')
    );
    if (forbidden) {
      e.preventDefault();
      showShortAlert('This keyboard shortcut is disabled during the exam!');
      logCheatViolation('keyboard_shortcut');
    }
  });

  // Fullscreen Enforcement
  function requestFullscreen() {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.mozRequestFullScreen) el.mozRequestFullScreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (el.msRequestFullscreen) el.msRequestFullscreen();
  }
  function isFullscreen() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
  }
  function enforceFullscreen() {
    if (!isFullscreen()) {
      showShortAlert('Exam must be in fullscreen! Please do not exit fullscreen.');
      logCheatViolation('fullscreen_exit');
      setTimeout(requestFullscreen, 500);
    }
  }
  document.addEventListener('fullscreenchange', enforceFullscreen);
  document.addEventListener('webkitfullscreenchange', enforceFullscreen);
  document.addEventListener('mozfullscreenchange', enforceFullscreen);
  document.addEventListener('msfullscreenchange', enforceFullscreen);

  // Request fullscreen at exam start
  setTimeout(requestFullscreen, 500);

  // --- 1. Frequent Webcam Snapshots & Face Matching ---
  let initialFaceImageData = null;
  let webcamSnapshotInterval = null;
  function captureWebcamSnapshot() {
    const video = document.getElementById('webcam');
    if (!video || video.readyState !== 4) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
  function compareFaceSnapshots(img1, img2) {
    // Simple pixel diff (not real face recognition, but detects major changes)
    if (!img1 || !img2 || img1.width !== img2.width || img1.height !== img2.height) return false;
    let diff = 0;
    for (let i = 0; i < img1.data.length; i += 16) { // Sample every 4th pixel
      diff += Math.abs(img1.data[i] - img2.data[i]);
    }
    return diff < 50000; // Threshold for major change
  }
  function takeInitialFaceSnapshot() {
    setTimeout(() => {
      initialFaceImageData = captureWebcamSnapshot();
    }, 2000);
  }
  function startWebcamSnapshotMonitoring() {
    webcamSnapshotInterval = setInterval(() => {
      const current = captureWebcamSnapshot();
      if (initialFaceImageData && current && !compareFaceSnapshots(initialFaceImageData, current)) {
        showShortAlert('Face mismatch detected! Ensure only you are present.');
        logCheatViolation('face_mismatch');
      }
    }, 20000); // Every 20 seconds
  }

  // --- 2. Idle Detection ---
  let lastActivityTime = Date.now();
  function resetIdleTimer() { lastActivityTime = Date.now(); }
  ['mousemove', 'keydown', 'mousedown', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, resetIdleTimer, true);
  });
  setInterval(() => {
    if (isExamActive && Date.now() - lastActivityTime > 60000) { // 1 minute idle
      showShortAlert('You have been idle for too long!');
      logCheatViolation('idle_timeout');
    }
  }, 15000);

  // --- 3. Multiple Face Detection (simple, using tracking.js) ---
  if (window.tracking && webcam) {
    const tracker = new tracking.ObjectTracker('face');
    tracker.setInitialScale(4);
    tracker.setStepSize(2);
    tracker.setEdgesDensity(0.1);
    tracking.track(webcam, tracker);
    tracker.on('track', function(event) {
      if (isExamActive && event.data.length > 1) {
        showShortAlert('Multiple faces detected! Only one person allowed.');
        logCheatViolation('multiple_faces');
      }
    });
  }

  // --- 4. Network Monitoring ---
  window.addEventListener('offline', () => {
    showShortAlert('Network disconnected! Exam activity will be logged.');
    logCheatViolation('network_offline');
  });
  window.addEventListener('online', () => {
    showShortAlert('Network reconnected.');
  });

  // --- 5. Window Resize Detection ---
  let lastWindowSize = { w: window.innerWidth, h: window.innerHeight };
  window.addEventListener('resize', () => {
    if (isExamActive && (Math.abs(window.innerWidth - lastWindowSize.w) > 30 || Math.abs(window.innerHeight - lastWindowSize.h) > 30)) {
      showShortAlert('Window resize detected! Do not resize the exam window.');
      logCheatViolation('window_resize');
    }
    lastWindowSize = { w: window.innerWidth, h: window.innerHeight };
  });

  // --- 6. Device Orientation Change (for mobile/tablet) ---
  window.addEventListener('orientationchange', () => {
    if (isExamActive) {
      showShortAlert('Device orientation changed!');
      logCheatViolation('orientation_change');
    }
  });

  // --- 7. Audio Level Monitoring (background noise spike) ---
  let lastAudioLevel = 0;
  function monitorBackgroundAudio() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      const mic = ctx.createMediaStreamSource(stream);
      analyser.fftSize = 1024;
      mic.connect(analyser);
      setInterval(() => {
        let arr = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(arr);
        let avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        if (isExamActive && avg > lastAudioLevel + 30 && avg > 40) {
          showShortAlert('Background noise spike detected!');
          logCheatViolation('audio_spike');
        }
        lastAudioLevel = avg;
      }, 10000);
    }).catch(() => {});
  }

  // Start all monitoring after exam begins
  if (isExamActive) {
    takeInitialFaceSnapshot();
    startWebcamSnapshotMonitoring();
    monitorBackgroundAudio();
  } else {
    // Wait for exam to start
    const examStartInterval = setInterval(() => {
      if (isExamActive) {
        takeInitialFaceSnapshot();
        startWebcamSnapshotMonitoring();
        monitorBackgroundAudio();
        clearInterval(examStartInterval);
      }
    }, 1000);
  }
}

// Log cheat violation (for anti-cheat features)
function logCheatViolation(type) {
  const currentTime = Date.now();
  monitoringData.violationTypes[type] = (monitoringData.violationTypes[type] || 0) + 1;
  monitoringData.totalViolations++;
  monitoringData.suspiciousEvents.push({
    timestamp: currentTime,
    violation: {
      type: type,
      severity: 'medium',
      message: `Cheating attempt detected: ${type}`
    },
    violationNumber: monitoringData.totalViolations
  });
  monitoringData.lastAlertTime = currentTime;
  updateViolationDisplay();
}

// --- Randomize Question Order ---
function randomizeQuestions() {
  // Assumes questions are in a container with id 'questions' and each question has class 'question'
  const container = document.getElementById('questions');
  if (!container) return;
  const questions = Array.from(container.getElementsByClassName('question'));
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    container.insertBefore(questions[j], questions[i]);
  }
}
let audioContext, analyser, microphone, javascriptNode;
let voiceAlertShown = false;
function startVoiceDetection() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    microphone = audioContext.createMediaStreamSource(stream);
    javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);
    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;
    microphone.connect(analyser);
    analyser.connect(javascriptNode);
    javascriptNode.connect(audioContext.destination);
    javascriptNode.onaudioprocess = function() {
      let array = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(array);
      let values = 0;
      for (let i = 0; i < array.length; i++) { values += array[i]; }
      let average = values / array.length;
      // If average volume is above threshold, consider as voice detected
      if (average > 25 && !voiceAlertShown) {
        voiceAlertShown = true;
        processVoiceViolation();
        setTimeout(() => { voiceAlertShown = false; }, 5000);
      }
    };
  }).catch(function(err) {
    console.warn('Microphone access denied or unavailable.', err);
  });
}

function processVoiceViolation() {
  const currentTime = Date.now();
  if (currentTime - monitoringData.lastAlertTime < MONITORING_CONFIG.ALERT_COOLDOWN) {
    return;
  }
  monitoringData.violationTypes.voice_detected = (monitoringData.violationTypes.voice_detected || 0) + 1;
  monitoringData.totalViolations++;
  monitoringData.suspiciousEvents.push({
    timestamp: currentTime,
    violation: {
      type: 'voice_detected',
      severity: 'high',
      message: 'Human voice detected! Please ensure a quiet environment.'
    },
    violationNumber: monitoringData.totalViolations
  });
  monitoringData.lastAlertTime = currentTime;
  showShortAlert(`Voice detected! (${getCurrentExamTime()})`);
  updateViolationDisplay();
}
// Elements
const landing = document.getElementById("landing");
const calibration = document.getElementById("calibration");
const exam = document.getElementById("exam");
const webcam = document.getElementById("webcam");
let examDuration = 10 * 60; // 10 minutes

// Calibration state
let calibrationStep = 0;
let calibrationPositions = [];
let sampleBuffer = [];
let eyeBoundary = null;
let isCalibrating = false;
let isExamActive = false;
let currentFacePosition = null;
let calibrationInterval = null;
// Enhanced monitoring state variables
let samplesCollected = 0;
const SAMPLES_PER_POSITION = 5;
let activeCalibrationPoint = null;

// Advanced monitoring state variables
let monitoringData = {
  faceHistory: [],
  eyeHistory: [],
  suspiciousEvents: [],
  violationTypes: {
    boundary_violation: 0,
    suspicious_movement: 0,
    quick_glance: 0,
    tab_switch: 0,
    window_minimize: 0,
    face_lost: 0,
    voice_detected: 0,
    screen_share: 0 // New: track screen share violations
  },
  totalViolations: 0,
  lastAlertTime: 0,
  baselineFaceSize: null,
  baselineFacePosition: null,
  calibrationComplete: false,
  stableFrameCount: 0
};

const MONITORING_CONFIG = {
  HISTORY_LENGTH: 15,
  SUSPICIOUS_MOVEMENT_THRESHOLD: 4.5, // Increased to reduce false positives
  QUICK_GLANCE_THRESHOLD: 20, // Increased threshold
  FACE_SIZE_VARIATION_LIMIT: 0.4, // More tolerance
  ALERT_COOLDOWN: 3000, // Increased cooldown
  POSITION_SMOOTHING: 0.8, // More smoothing
  STABLE_FRAMES_REQUIRED: 5, // Require stable detection before monitoring
  BOUNDARY_MARGIN_EXTRA: 25 // Additional margin for boundary
};

// Calibration point positions as percentages of screen dimensions
const calibrationPointPositions = [
  { x: 10, y: 10 },    // TOP-LEFT
  { x: 50, y: 10 },    // TOP-CENTER
  { x: 90, y: 10 },    // TOP-RIGHT
  { x: 10, y: 50 },    // MIDDLE-LEFT
  { x: 50, y: 50 },    // CENTER
  { x: 90, y: 50 },    // MIDDLE-RIGHT
  { x: 10, y: 90 },    // BOTTOM-LEFT
  { x: 50, y: 90 },    // BOTTOM-CENTER
  { x: 90, y: 90 }     // BOTTOM-RIGHT
];

const calibrationInstructions = [
  "Look at the TOP-LEFT corner of your screen and hold for 3 seconds.",
  "Look at the TOP-CENTER of your screen and hold for 3 seconds.",
  "Look at the TOP-RIGHT corner of your screen and hold for 3 seconds.",
  "Look at the MIDDLE-LEFT of your screen and hold for 3 seconds.",
  "Look at the CENTER of your screen and hold for 3 seconds.",
  "Look at the MIDDLE-RIGHT of your screen and hold for 3 seconds.",
  "Look at the BOTTOM-LEFT corner of your screen and hold for 3 seconds.",
  "Look at the BOTTOM-CENTER of your screen and hold for 3 seconds.",
  "Look at the BOTTOM-RIGHT corner of your screen and hold for 3 seconds.",
];

function startCalibration() {
  landing.style.display = "none";
  calibration.style.display = "block";
  calibrationStep = 0;
  calibrationPositions = [];
  sampleBuffer = [];
  isCalibrating = true;
  isExamActive = false;
  samplesCollected = 0;

  // Start voice detection when calibration begins
  startVoiceDetection();

  // Create progress element
  const progressContainer = document.createElement('div');
  progressContainer.id = 'calibration-progress-container';
  progressContainer.innerHTML = `
    <div id="calibration-progress-bar">
      <div id="calibration-progress-fill"></div>
    </div>
    <div id="calibration-counter">0/${SAMPLES_PER_POSITION}</div>
  `;

  // Update instructions to be more clear
  const instructionText = document.querySelector("#calibration p");
  instructionText.innerHTML = `
    <strong>Eye-tracking calibration:</strong><br>
    Please focus on each red dot as it appears on your screen.<br>
    The system will collect data while you're looking at each point.<br>
    Please keep your head relatively still during calibration.
  `;

  // Add progress bar after instruction text
  instructionText.insertAdjacentElement('afterend', progressContainer);

  // Add position indicator
  const positionIndicator = document.createElement('div');
  positionIndicator.id = 'position-indicator';
  positionIndicator.textContent = 'Looking at: TOP-LEFT';
  progressContainer.insertAdjacentElement('afterend', positionIndicator);

  navigator.mediaDevices.getUserMedia({ video: true })
    .then((stream) => {
      webcam.srcObject = stream;
      webcam.onloadedmetadata = () => {
        webcam.play();
        setupTracking();
        // Allow time for the camera to initialize before starting calibration
        setTimeout(() => {
          startCalibrationStep();
        }, 1000);
      };
    })
    .catch((err) => {
      alert("Could not access webcam: " + err.message);
    });
}


// Advanced face and eye tracking with comprehensive monitoring
function setupTracking() {
  const tracker = new tracking.ObjectTracker('face');
  tracker.setInitialScale(4);
  tracker.setStepSize(2);
  tracker.setEdgesDensity(0.1);

  tracking.track(webcam, tracker);
  
  const eyeStatus = document.getElementById("eye-status");
  const calBtn = document.getElementById("calibration-next");

  // Enhanced tracking variables
  let smoothedFacePosition = null;
  let smoothedEyePosition = null;
  
  tracker.on('track', function(event) {
    const currentTime = Date.now();
    
    if (event.data.length > 0) {
      const face = event.data[0];
      
      // Reset face lost tracking since we detected a face
      resetFaceLostTracking();
      
      // Enhanced face analysis
      const faceData = analyzeFace(face, currentTime);
      const eyeData = analyzeEyes(face, currentTime);
      
      // Apply position smoothing to reduce noise
      smoothedFacePosition = smoothPosition(smoothedFacePosition, faceData.center);
      smoothedEyePosition = smoothPosition(smoothedEyePosition, eyeData.center);
      
      // Store enhanced tracking data
      currentFacePosition = smoothedEyePosition;
      
      // Update monitoring history
      updateMonitoringHistory(faceData, eyeData, currentTime);
      
      if (isCalibrating) {
        handleCalibrationMode(eyeStatus, calBtn);
      } else if (isExamActive && eyeBoundary) {
        performAdvancedMonitoring(faceData, eyeData, currentTime);
      }
      
    } else {
      handleNoFaceDetected(eyeStatus, calBtn);
    }
  });
}

// Analyze face properties and position
function analyzeFace(face, timestamp) {
  const center = [face.x + (face.width / 2), face.y + (face.height / 2)];
  const size = Math.sqrt(face.width * face.height);
  
  return {
    center: center,
    size: size,
    width: face.width,
    height: face.height,
    timestamp: timestamp,
    bounds: {
      left: face.x,
      right: face.x + face.width,
      top: face.y,
      bottom: face.y + face.height
    }
  };
}

// Analyze eye positions with enhanced accuracy
function analyzeEyes(face, timestamp) {
  // More precise eye position calculation
  const leftEyeX = face.x + (face.width * 0.35);
  const rightEyeX = face.x + (face.width * 0.65);
  const eyesY = face.y + (face.height * 0.35);
  
  const leftEye = [leftEyeX, eyesY];
  const rightEye = [rightEyeX, eyesY];
  const center = [(leftEyeX + rightEyeX) / 2, eyesY];
  
  return {
    left: leftEye,
    right: rightEye,
    center: center,
    separation: Math.abs(rightEyeX - leftEyeX),
    timestamp: timestamp
  };
}

// Apply position smoothing to reduce jitter
function smoothPosition(previous, current) {
  if (!previous) return current;
  
  const smoothing = MONITORING_CONFIG.POSITION_SMOOTHING;
  return [
    previous[0] * smoothing + current[0] * (1 - smoothing),
    previous[1] * smoothing + current[1] * (1 - smoothing)
  ];
}

// Update monitoring history with latest data
function updateMonitoringHistory(faceData, eyeData, timestamp) {
  monitoringData.faceHistory.push(faceData);
  monitoringData.eyeHistory.push(eyeData);
  
  // Maintain history length
  if (monitoringData.faceHistory.length > MONITORING_CONFIG.HISTORY_LENGTH) {
    monitoringData.faceHistory.shift();
  }
  if (monitoringData.eyeHistory.length > MONITORING_CONFIG.HISTORY_LENGTH) {
    monitoringData.eyeHistory.shift();
  }
  
  // Increment stable frame count for consistent detection
  monitoringData.stableFrameCount++;
  
  // Set baseline during early tracking (after stable detection)
  if (!monitoringData.baselineFaceSize && monitoringData.faceHistory.length >= 8 && 
      monitoringData.stableFrameCount >= MONITORING_CONFIG.STABLE_FRAMES_REQUIRED) {
    monitoringData.baselineFaceSize = calculateAverageFaceSize();
    monitoringData.baselineFacePosition = calculateAverageFacePosition();
    console.log("Baseline established:", {
      faceSize: monitoringData.baselineFaceSize,
      facePosition: monitoringData.baselineFacePosition
    });
  }
}

// Handle calibration mode
function handleCalibrationMode(eyeStatus, calBtn) {
  window.currentIris = currentFacePosition;
  if (eyeStatus) {
    eyeStatus.textContent = "Face detected";
    eyeStatus.style.color = "#16a34a";
  }
  if (calBtn) calBtn.disabled = false;
}

// Perform advanced monitoring during exam
function performAdvancedMonitoring(faceData, eyeData, currentTime) {
  // Only start monitoring after stable detection and baseline establishment
  if (monitoringData.stableFrameCount < MONITORING_CONFIG.STABLE_FRAMES_REQUIRED || 
      !monitoringData.baselineFaceSize) {
    return;
  }
  
  const violations = [];
  
  // 1. Enhanced boundary check with precise boundaries
  const boundaryViolation = checkPreciseBoundary(eyeData.center);
  if (boundaryViolation.detected) {
    violations.push({
      type: 'boundary_violation',
      severity: boundaryViolation.severity,
      message: boundaryViolation.message
    });
  }
  
  // 2. Improved suspicious eye movement detection
  const suspiciousMovement = detectSuspiciousEyeMovement();
  if (suspiciousMovement.detected) {
    violations.push({
      type: 'suspicious_movement',
      severity: 'medium',
      message: suspiciousMovement.reason
    });
  }
  
  // 3. Quick glance detection (improved)
  const quickGlance = detectQuickGlances();
  if (quickGlance.detected) {
    violations.push({
      type: 'quick_glance',
      severity: 'high',
      message: quickGlance.reason
    });
  }
  
  // Process violations
  if (violations.length > 0) {
    processViolations(violations, currentTime);
  }
}

// Check boundary violations with precise detection
function checkPreciseBoundary(eyePosition) {
  if (!eyeBoundary) {
    return { detected: false };
  }
  
  const [x, y] = eyePosition;
  
  // Check against primary boundary (strict)
  const outsidePrimary = (
    x < eyeBoundary.minX || x > eyeBoundary.maxX ||
    y < eyeBoundary.minY || y > eyeBoundary.maxY
  );
  
  // Check against warning boundary (looser)
  const outsideWarning = (
    x < eyeBoundary.warningMinX || x > eyeBoundary.warningMaxX ||
    y < eyeBoundary.warningMinY || y > eyeBoundary.warningMaxY
  );
  
  if (outsidePrimary) {
    // Calculate how far outside the boundary
    const distanceFromCenter = Math.sqrt(
      Math.pow(x - eyeBoundary.centerX, 2) + 
      Math.pow(y - eyeBoundary.centerY, 2)
    );
    
    const expectedMaxDistance = Math.sqrt(
      Math.pow(eyeBoundary.width / 2, 2) + 
      Math.pow(eyeBoundary.height / 2, 2)
    );
    
    const violationSeverity = distanceFromCenter > expectedMaxDistance * 1.5 ? 'high' : 'medium';
    
    // Determine direction of violation for more specific message
    let direction = "";
    if (x < eyeBoundary.minX) direction += "left ";
    if (x > eyeBoundary.maxX) direction += "right ";
    if (y < eyeBoundary.minY) direction += "up ";
    if (y > eyeBoundary.maxY) direction += "down ";
    
    return {
      detected: true,
      severity: violationSeverity,
      message: `Looking ${direction.trim()} outside screen boundary (distance: ${Math.round(distanceFromCenter - expectedMaxDistance)}px)`,
      distance: distanceFromCenter,
      direction: direction.trim()
    };
  }
  
  if (outsideWarning) {
    // Early warning - log but don't create violation yet
    console.log("Warning: Eye position approaching boundary", { x, y, boundary: eyeBoundary });
  }
  
  return { detected: false };
}

// Detect suspicious eye movements
function detectSuspiciousEyeMovement() {
  if (monitoringData.eyeHistory.length < 10) {
    return { detected: false };
  }
  
  const recentEyes = monitoringData.eyeHistory.slice(-10);
  const recentFaces = monitoringData.faceHistory.slice(-10);
  
  const eyeMovement = calculateMovement(recentEyes.map(e => e.center));
  const faceMovement = calculateMovement(recentFaces.map(f => f.center));
  
  const movementRatio = eyeMovement / (faceMovement + 1); // Increased denominator
  
  // More stringent detection to reduce false positives
  if (movementRatio > MONITORING_CONFIG.SUSPICIOUS_MOVEMENT_THRESHOLD && 
      eyeMovement > 15 && faceMovement < 3) {
    return {
      detected: true,
      reason: `Suspicious eye movement detected (ratio: ${movementRatio.toFixed(2)})`
    };
  }
  
  return { detected: false };
}

// Detect distance changes (moving closer/farther from camera)
function detectDistanceChange(faceData) {
  if (!monitoringData.baselineFaceSize) {
    return { detected: false };
  }
  
  const sizeRatio = faceData.size / monitoringData.baselineFaceSize;
  const threshold = MONITORING_CONFIG.FACE_SIZE_VARIATION_LIMIT;
  
  if (sizeRatio < (1 - threshold)) {
    return {
      detected: true,
      reason: 'Moved too far from camera'
    };
  } else if (sizeRatio > (1 + threshold)) {
    return {
      detected: true,
      reason: 'Moved too close to camera'
    };
  }
  
  return { detected: false };
}

// Detect quick glances
function detectQuickGlances() {
  if (monitoringData.eyeHistory.length < 5) {
    return { detected: false };
  }
  
  const recent = monitoringData.eyeHistory.slice(-5);
  let maxMovement = 0;
  
  for (let i = 1; i < recent.length; i++) {
    const movement = distance(recent[i-1].center, recent[i].center);
    maxMovement = Math.max(maxMovement, movement);
  }
  
  if (maxMovement > MONITORING_CONFIG.QUICK_GLANCE_THRESHOLD) {
    return {
      detected: true,
      reason: `Quick glance detected (movement: ${maxMovement.toFixed(1)}px)`
    };
  }
  
  return { detected: false };
}

// Detect face orientation changes
function detectFaceOrientation(faceData) {
  if (monitoringData.faceHistory.length < 3) {
    return { detected: false };
  }
  
  const current = faceData;
  const baseline = monitoringData.baselineFacePosition;
  
  if (!baseline) return { detected: false };
  
  // Check if face has rotated significantly based on width/height ratio changes
  const currentRatio = current.width / current.height;
  const expectedRatio = 0.75; // Typical face width/height ratio
  
  if (Math.abs(currentRatio - expectedRatio) > 0.3) {
    return {
      detected: true,
      reason: 'Face orientation changed significantly'
    };
  }
  
  return { detected: false };
}

// Process detected violations
function processViolations(violations, currentTime) {
  // Implement alert cooldown
  if (currentTime - monitoringData.lastAlertTime < MONITORING_CONFIG.ALERT_COOLDOWN) {
    return;
  }

  // Find highest severity violation
  const highSeverity = violations.find(v => v.severity === 'high');
  const violation = highSeverity || violations[0];

  // Record violation by type
  monitoringData.violationTypes[violation.type]++;
  monitoringData.totalViolations++;

  // Record violation details
  monitoringData.suspiciousEvents.push({
    timestamp: currentTime,
    violation: violation,
    violationNumber: monitoringData.totalViolations
  });

  // Show short alert (no popup)
  if (!window.eyeAlerted) {
    window.eyeAlerted = true;
    monitoringData.lastAlertTime = currentTime;

    showShortAlert(`${violation.message} (${getCurrentExamTime()})`);

    console.log(`Violation #${monitoringData.totalViolations}:`, violation);

    // Update display immediately
    updateViolationDisplay();

    setTimeout(() => { window.eyeAlerted = false; }, 3000);
  }
}
// Show a short, non-intrusive alert at the top of the screen
function showShortAlert(message) {
  let alertDiv = document.getElementById('short-alert');
  if (!alertDiv) {
    alertDiv = document.createElement('div');
    alertDiv.id = 'short-alert';
    alertDiv.style.cssText = `
      position: fixed;
      top: 70px;
      left: 50%;
      transform: translateX(-50%);
      background: #f87171;
      color: #fff;
      padding: 0.7rem 2rem;
      border-radius: 8px;
      font-size: 1.1rem;
      font-weight: 600;
      z-index: 9999;
      box-shadow: 0 2px 12px rgba(99,102,241,0.12);
      opacity: 0.98;
      transition: opacity 0.3s;
    `;
    document.body.appendChild(alertDiv);
  }
  alertDiv.textContent = message;
  alertDiv.style.display = 'block';
  alertDiv.style.opacity = '0.98';
  setTimeout(() => {
    alertDiv.style.opacity = '0';
    setTimeout(() => { alertDiv.style.display = 'none'; }, 400);
  }, 2200);
}

// Get the current exam time as mm:ss
function getCurrentExamTime() {
  const timerElement = document.getElementById('timer');
  if (timerElement && timerElement.textContent) {
    return timerElement.textContent.trim();
  }
  return '--:--';
}

// Handle no face detected
// Enhanced face lost detection with sustained tracking
let faceLostStartTime = null;
let faceLostAlerted = false;

function handleNoFaceDetected(eyeStatus, calBtn) {
  if (isCalibrating && eyeStatus) {
    eyeStatus.textContent = "Face not detected";
    eyeStatus.style.color = "#b91c1c";
  }
  if (calBtn) calBtn.disabled = true;
  
  // Track when face was first lost
  if (isExamActive && !faceLostStartTime) {
    faceLostStartTime = Date.now();
  }
  
  // Reset stable frame count
  monitoringData.stableFrameCount = 0;
  
  // Clear monitoring history when face is lost
  monitoringData.faceHistory = [];
  monitoringData.eyeHistory = [];
  
  // Alert if face is lost during exam for more than 3 seconds
  if (isExamActive && faceLostStartTime && !faceLostAlerted && 
      Date.now() - faceLostStartTime > 3000 && 
      Date.now() - monitoringData.lastAlertTime > MONITORING_CONFIG.ALERT_COOLDOWN) {
    
    faceLostAlerted = true;
    
    // Record face lost violation
    monitoringData.violationTypes.face_lost++;
    monitoringData.totalViolations++;
    
    const faceLostDuration = Math.round((Date.now() - faceLostStartTime) / 1000);
    const message = `Face lost for ${faceLostDuration} seconds! Please ensure you remain visible to the camera. (${getCurrentExamTime()})`;
    showShortAlert(message);
    // Record violation details
    monitoringData.suspiciousEvents.push({
      timestamp: Date.now(),
      violation: {
        type: 'face_lost',
        severity: 'high',
        message: `Face lost for ${faceLostDuration} seconds`
      },
      violationNumber: monitoringData.totalViolations
    });
    
    monitoringData.lastAlertTime = Date.now();
    updateViolationDisplay();
  }
}

// Reset face lost tracking when face is detected again
function resetFaceLostTracking() {
  if (faceLostStartTime || faceLostAlerted) {
    console.log('Face detected again - resetting face lost tracking');
    faceLostStartTime = null;
    faceLostAlerted = false;
  }
}

// Calculate average face size for baseline
function calculateAverageFaceSize() {
  const sizes = monitoringData.faceHistory.map(f => f.size);
  return sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
}

// Calculate average face position for baseline
function calculateAverageFacePosition() {
  const positions = monitoringData.faceHistory.map(f => f.center);
  const sumX = positions.reduce((sum, pos) => sum + pos[0], 0);
  const sumY = positions.reduce((sum, pos) => sum + pos[1], 0);
  return [sumX / positions.length, sumY / positions.length];
}

// Calculate distance between two points
function distance(point1, point2) {
  const dx = point1[0] - point2[0];
  const dy = point1[1] - point2[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// Calculate total movement distance across a series of positions
function calculateMovement(positions) {
  if (positions.length < 2) return 0;
  
  let totalMovement = 0;
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i-1];
    const curr = positions[i];
    
    // Calculate Euclidean distance
    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    const distance = Math.sqrt(dx*dx + dy*dy);
    
    totalMovement += distance;
  }
  
  return totalMovement;
}

function isWithinBoundary(point, boundary) {
  // boundary: {minX, maxX, minY, maxY}
  return (
    point[0] >= boundary.minX && point[0] <= boundary.maxX &&
    point[1] >= boundary.minY && point[1] <= boundary.maxY
  );
}

// Calibration button logic
// Function to start collecting samples for the current calibration step
function startCalibrationStep() {
  // Reset buffer for this position
  sampleBuffer = [];
  samplesCollected = 0;
  updateCalibrationProgress(0);
  
  // Remove previous point if it exists
  if (activeCalibrationPoint) {
    document.body.removeChild(activeCalibrationPoint);
  }
  
  // Create calibration point at the current target position
  const pointPosition = calibrationPointPositions[calibrationStep];
  
  // Position is specified as percentage of screen dimensions
  const x = (window.innerWidth * pointPosition.x) / 100;
  const y = (window.innerHeight * pointPosition.y) / 100;
  
  // Create the point element
  const point = document.createElement('div');
  point.className = 'calibration-point';
  point.style.left = x + 'px';
  point.style.top = y + 'px';
  document.body.appendChild(point);
  
  activeCalibrationPoint = point;
  
  // Wait for 1 second before starting to collect samples
  // This gives the user time to focus on the point
  setTimeout(() => {
    // Start collecting samples at regular intervals
    if (calibrationInterval) {
      clearInterval(calibrationInterval);
    }
    
    calibrationInterval = setInterval(() => {
      if (currentFacePosition && sampleBuffer.length < SAMPLES_PER_POSITION) {
        // Add current position to the buffer
        sampleBuffer.push([...currentFacePosition]);
        samplesCollected++;
        
        // Update progress
        updateCalibrationProgress(samplesCollected / SAMPLES_PER_POSITION);
        
        if (samplesCollected >= SAMPLES_PER_POSITION) {
          // We've collected enough samples
          clearInterval(calibrationInterval);
          
          // Calculate average position for this calibration point
          const avgPosition = calculateAveragePosition(sampleBuffer);
          calibrationPositions.push(avgPosition);
          
          console.log(`Calibration step ${calibrationStep}: Average position at [${avgPosition}] from ${sampleBuffer.length} samples`);
          
          // Go to next calibration step after a short delay
          setTimeout(() => {
            moveToNextCalibrationStep();
          }, 500);
        }
      }
    }, 300); // Collect a sample every 300ms
  }, 1000); // Wait 1 second before collecting samples
}

// Update the progress bar
function updateCalibrationProgress(progress) {
  const progressFill = document.getElementById('calibration-progress-fill');
  const progressCounter = document.getElementById('calibration-counter');
  
  if (progressFill && progressCounter) {
    progressFill.style.width = `${progress * 100}%`;
    progressCounter.textContent = `${samplesCollected}/${SAMPLES_PER_POSITION}`;
  }
}

// Calculate average position from multiple samples
function calculateAveragePosition(samples) {
  if (!samples.length) return [0, 0];
  
  const sum = samples.reduce((acc, pos) => {
    acc[0] += pos[0];
    acc[1] += pos[1];
    return acc;
  }, [0, 0]);
  
  return [sum[0] / samples.length, sum[1] / samples.length];
}

// Move to the next calibration step
function moveToNextCalibrationStep() {
  calibrationStep++;
  if (calibrationStep < calibrationInstructions.length) {
    // Update the position indicator
    const positionIndicator = document.getElementById('position-indicator');
    if (positionIndicator) {
      // Extract position name from the instruction
      const positionText = calibrationInstructions[calibrationStep]
        .replace("Look at the ", "")
        .replace(" of your screen and hold for 3 seconds.", "");
      
      positionIndicator.textContent = `Looking at: ${positionText}`;
    }
    
    startCalibrationStep();
  } else {
    // Finish calibration
    finishCalibration();
  }
}

// Finish the calibration process
function finishCalibration() {
  if (calibrationInterval) {
    clearInterval(calibrationInterval);
  }
  
  // Remove calibration point if it exists
  if (activeCalibrationPoint) {
    document.body.removeChild(activeCalibrationPoint);
    activeCalibrationPoint = null;
  }
  
  // Calculate precise boundary from all calibration points
  eyeBoundary = calculatePreciseBoundary(calibrationPositions);
  
  console.log("Precise eye boundary set:", eyeBoundary);
  console.log("Total calibration points:", calibrationPositions.length);
  console.log("Calibration positions:", calibrationPositions);
  
  // Mark calibration as complete
  monitoringData.calibrationComplete = true;
  
  isCalibrating = false;
  startExam();
}

// Calculate a more precise boundary using statistical analysis
function calculatePreciseBoundary(positions) {
  if (positions.length < 4) {
    throw new Error("Insufficient calibration points for boundary calculation");
  }
  
  const xs = positions.map(p => p[0]);
  const ys = positions.map(p => p[1]);
  
  // Calculate statistical measures
  const xStats = calculateStatistics(xs);
  const yStats = calculateStatistics(ys);
  
  console.log("X Statistics:", xStats);
  console.log("Y Statistics:", yStats);
  
  // Use a more sophisticated boundary calculation
  // Instead of just min/max, use percentiles and outlier detection
  const xMargin = Math.max(15, xStats.stdDev * 1.5); // Dynamic margin based on variance
  const yMargin = Math.max(15, yStats.stdDev * 1.5);
  
  // Create primary boundary (stricter)
  const primaryBoundary = {
    minX: xStats.p10 - xMargin,  // 10th percentile minus margin
    maxX: xStats.p90 + xMargin,  // 90th percentile plus margin
    minY: yStats.p10 - yMargin,
    maxY: yStats.p90 + yMargin
  };
  
  // Create warning boundary (looser)
  const warningBoundary = {
    minX: Math.min(...xs) - (xMargin * 2),
    maxX: Math.max(...xs) + (xMargin * 2),
    minY: Math.min(...ys) - (yMargin * 2),
    maxY: Math.max(...ys) + (yMargin * 2)
  };
  
  // Calculate center point and dimensions
  const centerX = (primaryBoundary.minX + primaryBoundary.maxX) / 2;
  const centerY = (primaryBoundary.minY + primaryBoundary.maxY) / 2;
  const width = primaryBoundary.maxX - primaryBoundary.minX;
  const height = primaryBoundary.maxY - primaryBoundary.minY;
  
  return {
    // Primary boundary for strict detection
    minX: primaryBoundary.minX,
    maxX: primaryBoundary.maxX,
    minY: primaryBoundary.minY,
    maxY: primaryBoundary.maxY,
    
    // Warning boundary for early alerts
    warningMinX: warningBoundary.minX,
    warningMaxX: warningBoundary.maxX,
    warningMinY: warningBoundary.minY,
    warningMaxY: warningBoundary.maxY,
    
    // Center and dimensions
    centerX: centerX,
    centerY: centerY,
    width: width,
    height: height,
    
    // Statistics for reference
    xStats: xStats,
    yStats: yStats,
    
    // Confidence score based on calibration quality
    confidence: calculateCalibrationConfidence(positions, xStats, yStats)
  };
}

// Calculate statistical measures for a dataset
function calculateStatistics(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  
  const mean = values.reduce((sum, val) => sum + val, 0) / n;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: mean,
    median: n % 2 === 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)],
    stdDev: stdDev,
    variance: variance,
    p10: sorted[Math.floor(n * 0.1)],   // 10th percentile
    p25: sorted[Math.floor(n * 0.25)],  // 25th percentile
    p75: sorted[Math.floor(n * 0.75)],  // 75th percentile
    p90: sorted[Math.floor(n * 0.9)],   // 90th percentile
    range: Math.max(...values) - Math.min(...values)
  };
}

// Calculate confidence score for calibration quality
function calculateCalibrationConfidence(positions, xStats, yStats) {
  // Factors that affect confidence:
  // 1. Number of calibration points
  // 2. Consistency of measurements (low standard deviation)
  // 3. Coverage of screen area
  // 4. Outlier detection
  
  const pointScore = Math.min(positions.length / 9, 1); // Optimal with 9 points
  const consistencyScore = Math.max(0, 1 - (xStats.stdDev + yStats.stdDev) / 100);
  const coverageScore = Math.min((xStats.range * yStats.range) / (400 * 300), 1); // Normalized coverage
  
  const confidence = (pointScore * 0.4 + consistencyScore * 0.4 + coverageScore * 0.2);
  
  console.log("Calibration confidence factors:", {
    pointScore,
    consistencyScore,
    coverageScore,
    totalConfidence: confidence
  });
  
  return confidence;
}

// Get calibration quality message based on confidence score
function getCalibrationQualityMessage(confidence) {
  if (confidence >= 0.9) {
    return "Excellent - Very precise boundary detection";
  } else if (confidence >= 0.8) {
    return "Good - Reliable boundary detection";
  } else if (confidence >= 0.7) {
    return "Fair - Adequate boundary detection";
  } else if (confidence >= 0.6) {
    return "Poor - Consider recalibrating";
  } else {
    return "Very Poor - Recalibration recommended";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const calBtn = document.getElementById("calibration-next");
  calBtn.style.display = "none"; // Hide the button, we're using automatic calibration now
});

// Finish calibration -> start exam
function startExam() {
  calibration.style.display = "none";
  exam.style.display = "block";
  isExamActive = true;
  startTimer();
  monitorTabSwitching();

  // Start voice detection when exam begins
  startVoiceDetection();
  // Start screen share detection when exam begins
  detectScreenShare();

  // Enable anti-cheat features (clipboard, context menu, shortcuts, fullscreen)
  enableAntiCheatFeatures();

  // Randomize question order
  randomizeQuestions();

  // Generate calibration quality message
  const confidencePercentage = Math.round(eyeBoundary.confidence * 100);
  const qualityMessage = getCalibrationQualityMessage(eyeBoundary.confidence);

  // Add enhanced monitoring message with detailed violation display
  const examMessage = document.createElement("div");
  examMessage.className = "exam-message";
  examMessage.innerHTML = `
    <p><strong>Advanced Exam Proctoring Active</strong></p>
    <p>✓ Precise boundary detection (${confidencePercentage}% confidence)</p>
    <p>✓ Eye movement and gaze tracking</p>
    <p>✓ Face position monitoring</p>
    <p>✓ Tab switching and window focus detection</p>
    <p>✓ <span style="color:#f87171;">Voice detection active</span></p>
    <p>✓ <span style="color:#fbbf24;">Screen share detection active</span></p>
    <div class="calibration-quality">
      <small>Calibration Quality: ${qualityMessage}</small>
    </div>
    <div class="violation-summary">
      <div class="violation-header">Security Violations</div>
      <div class="violation-grid">
        <div class="violation-item">
          <span class="violation-type">Looking Away:</span>
          <span class="violation-count" id="boundary-count">0</span>
        </div>
        <div class="violation-item">
          <span class="violation-type">Eye Movement:</span>
          <span class="violation-count" id="movement-count">0</span>
        </div>
        <div class="violation-item">
          <span class="violation-type">Quick Glance:</span>
          <span class="violation-count" id="glance-count">0</span>
        </div>
        <div class="violation-item">
          <span class="violation-type">Tab Switch:</span>
          <span class="violation-count" id="tab-switch-count">0</span>
        </div>
        <div class="violation-item">
          <span class="violation-type">Window Minimize:</span>
          <span class="violation-count" id="window-minimize-count">0</span>
        </div>
        <div class="violation-item">
          <span class="violation-type">Face Lost:</span>
          <span class="violation-count" id="face-lost-count">0</span>
        </div>
        <div class="violation-item">
          <span class="violation-type">Voice Detected:</span>
          <span class="violation-count" id="voice-detected-count">0</span>
        </div>
        <div class="violation-item">
          <span class="violation-type">Screen Share:</span>
          <span class="violation-count" id="screen-share-count">0</span>
        </div>
      </div>
      <div class="total-violations">
        Total Violations: <span id="total-violations">0</span>
      </div>
    </div>
  `;
  exam.insertBefore(examMessage, exam.firstChild.nextSibling);

  // Show boundary visualization if debug mode is enabled
  if (SHOW_BOUNDARY_DEBUG) {
    setTimeout(() => visualizeBoundaries(true), 1000);
  }

  // Start monitoring data display updates
  setInterval(updateViolationDisplay, 1000);
}

// Update violation display with current stats
function updateViolationDisplay() {
  // Update individual violation counts
  const updateCount = (id, count) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = count;
      element.className = `violation-count ${count > 0 ? 'has-violations' : ''}`;
    }
  };

  updateCount('boundary-count', monitoringData.violationTypes.boundary_violation);
  updateCount('movement-count', monitoringData.violationTypes.suspicious_movement);
  updateCount('glance-count', monitoringData.violationTypes.quick_glance);
  updateCount('tab-switch-count', monitoringData.violationTypes.tab_switch);
  updateCount('window-minimize-count', monitoringData.violationTypes.window_minimize);
  updateCount('face-lost-count', monitoringData.violationTypes.face_lost);

  updateCount('voice-detected-count', monitoringData.violationTypes.voice_detected || 0);
  updateCount('screen-share-count', monitoringData.violationTypes.screen_share || 0);
  updateCount('screen-share-count', monitoringData.violationTypes.screen_share || 0);

  // Update total violations
  const totalElement = document.getElementById('total-violations');
  if (totalElement) {
    totalElement.textContent = monitoringData.totalViolations;

    // Change color based on total violation count
    if (monitoringData.totalViolations === 0) {
      totalElement.style.color = '#16a34a';
    } else if (monitoringData.totalViolations <= 3) {
      totalElement.style.color = '#f59e0b';
    } else {
      totalElement.style.color = '#dc2626';
    }
  }
}

// Timer
function startTimer() {
  const timerElement = document.getElementById("timer");
  const interval = setInterval(() => {
    const minutes = Math.floor(examDuration / 60);
    const seconds = examDuration % 60;
    timerElement.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    examDuration--;
    if (examDuration < 0) {
      clearInterval(interval);
      alert("Time's up! Submitting exam...");
      document.getElementById("examForm").submit();
    }
  }, 1000);
}

// Tab monitoring with improved violation tracking
let focusLostTime = null;
let focusLostCount = 0;
let isWindowFocused = true;
let lastViolationType = null;

function monitorTabSwitching() {
  // Track when page becomes hidden (user switches tabs or minimizes)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // Page is now hidden - could be tab switch or window minimize
      isWindowFocused = false;
      focusLostTime = new Date();
      focusLostCount++;
      
      console.log(`Page hidden at ${focusLostTime.toLocaleTimeString()}`);
      
    } else {
      // Page is now visible again
      isWindowFocused = true;
      
      if (focusLostTime) {
        // Calculate time away
        const timeAway = Math.round((new Date() - focusLostTime) / 1000);
        
        // Only alert and count if they were away for more than 2 seconds (avoid false positives)
        if (timeAway > 2) {
          // Determine violation type based on context
          let violationType;
          let violationMessage;
          
          // Check if this was likely a tab switch or window minimize
          // If document.hidden changed but window focus didn't, it's likely a tab switch
          // If both changed, it's likely window minimize or alt-tab
          if (document.hasFocus()) {
            violationType = 'tab_switch';
            violationMessage = `Tab switched for ${timeAway} seconds`;
            monitoringData.violationTypes.tab_switch++;
          } else {
            violationType = 'window_minimize';
            violationMessage = `Window minimized or lost focus for ${timeAway} seconds`;
            monitoringData.violationTypes.window_minimize++;
          }
          
          monitoringData.totalViolations++;
          
          const message = `${violationMessage}! This has been recorded. (${getCurrentExamTime()})`;
          showShortAlert(message);
          // Record violation details
          monitoringData.suspiciousEvents.push({
            timestamp: Date.now(),
            violation: {
              type: violationType,
              severity: 'high',
              message: violationMessage
            },
            violationNumber: monitoringData.totalViolations
          });
          
          // Update display
          updateViolationDisplay();
          
          console.log(`${violationType} violation #${monitoringData.totalViolations}: Away for ${timeAway} seconds`);
          lastViolationType = violationType;
        }
        
        focusLostTime = null;
      }
    }
  });
  
  // Window focus events as additional context
  window.addEventListener("blur", () => {
    // Window lost focus - don't create violation here, wait for visibility change
    console.log(`Window blur detected at ${new Date().toLocaleTimeString()}`);
  });
  
  window.addEventListener("focus", () => {
    // Window regained focus
    console.log(`Window focus detected at ${new Date().toLocaleTimeString()}`);
  });
}

// Debug function to visualize boundaries (for testing purposes)
function visualizeBoundaries(show = false) {
  // Remove existing boundary visualization
  const existingBoundary = document.getElementById('boundary-visualization');
  if (existingBoundary) {
    existingBoundary.remove();
  }
  
  if (!show || !eyeBoundary) return;
  
  // Create boundary visualization overlay
  const boundaryDiv = document.createElement('div');
  boundaryDiv.id = 'boundary-visualization';
  boundaryDiv.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 10000;
  `;
  
  // Primary boundary (red)
  const primaryBoundary = document.createElement('div');
  primaryBoundary.style.cssText = `
    position: absolute;
    left: ${eyeBoundary.minX}px;
    top: ${eyeBoundary.minY}px;
    width: ${eyeBoundary.maxX - eyeBoundary.minX}px;
    height: ${eyeBoundary.maxY - eyeBoundary.minY}px;
    border: 2px solid red;
    background-color: rgba(255, 0, 0, 0.1);
  `;
  
  // Warning boundary (yellow)
  const warningBoundary = document.createElement('div');
  warningBoundary.style.cssText = `
    position: absolute;
    left: ${eyeBoundary.warningMinX}px;
    top: ${eyeBoundary.warningMinY}px;
    width: ${eyeBoundary.warningMaxX - eyeBoundary.warningMinX}px;
    height: ${eyeBoundary.warningMaxY - eyeBoundary.warningMinY}px;
    border: 2px dashed orange;
    background-color: rgba(255, 165, 0, 0.05);
  `;
  
  // Center point
  const centerPoint = document.createElement('div');
  centerPoint.style.cssText = `
    position: absolute;
    left: ${eyeBoundary.centerX - 5}px;
    top: ${eyeBoundary.centerY - 5}px;
    width: 10px;
    height: 10px;
    background-color: blue;
    border-radius: 50%;
  `;
  
  boundaryDiv.appendChild(warningBoundary);
  boundaryDiv.appendChild(primaryBoundary);
  boundaryDiv.appendChild(centerPoint);
  document.body.appendChild(boundaryDiv);
  
  console.log('Boundary visualization enabled. Primary (red) and Warning (orange) boundaries shown.');
}

// Enable boundary visualization for testing (set to true to see boundaries)
const SHOW_BOUNDARY_DEBUG = false;

// ================= GOOGLE DRIVE INTEGRATION =================
// Replace with your actual client ID
const GOOGLE_CLIENT_ID = '687381277163-71rae1h2r3s40jarps91o5itlr8ran33.apps.googleusercontent.com'; // <-- Replace with your client ID
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.file';

let gapiLoaded = false;
let googleAuthInstance = null;
let driveAccessToken = null;

// Load Google API JS client
function loadGapiClient() {
  return new Promise((resolve, reject) => {
    if (gapiLoaded) return resolve();
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => {
      gapiLoaded = true;
      resolve();
    };
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

// Initialize Google Auth
async function initGoogleAuth() {
  await loadGapiClient();
  return new Promise((resolve, reject) => {
    window.gapi.load('client:auth2', async () => {
      try {
        await window.gapi.client.init({
          clientId: GOOGLE_CLIENT_ID,
          scope: GOOGLE_SCOPES
        });
        googleAuthInstance = window.gapi.auth2.getAuthInstance();
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Prompt user to sign in and get access token
async function getDriveAccessToken() {
  await initGoogleAuth();
  if (!googleAuthInstance.isSignedIn.get()) {
    await googleAuthInstance.signIn();
  }
  const user = googleAuthInstance.currentUser.get();
  const token = user.getAuthResponse().access_token;
  driveAccessToken = token;
  return token;
}

// Upload a file to Google Drive
async function uploadFileToDrive({name, mimeType, data}) {
  if (!driveAccessToken) await getDriveAccessToken();
  const metadata = {
    name,
    mimeType
  };
  const boundary = '-------314159265358979323846';
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";
  let multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: ' + mimeType + '\r\n\r\n' +
    data +
    close_delim;

  return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + driveAccessToken,
      'Content-Type': 'multipart/related; boundary=' + boundary
    },
    body: multipartRequestBody
  }).then(res => res.json());
}

// ================== SESSION DATA CAPTURE ===================
let mediaRecorder = null;
let recordedBlobs = [];
let audioRecorder = null;
let audioBlobs = [];
let driveUploadStatus = '';

// Start recording webcam and mic
async function startSessionRecording() {
  // Webcam video
  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    mediaRecorder = new MediaRecorder(videoStream, { mimeType: 'video/webm;codecs=vp8,opus' });
    recordedBlobs = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedBlobs.push(e.data); };
    mediaRecorder.start();
  } catch (e) {
    console.warn('Webcam+mic recording failed:', e);
  }
  // Microphone only (for background audio, if needed)
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
    audioBlobs = [];
    audioRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioBlobs.push(e.data); };
    audioRecorder.start();
  } catch (e) {
    console.warn('Mic-only recording failed:', e);
  }
}

// Stop all recordings
function stopSessionRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (audioRecorder && audioRecorder.state !== 'inactive') audioRecorder.stop();
}

// Save and upload all session data to Google Drive
async function uploadSessionDataToDrive() {
  driveUploadStatus = 'Uploading...';
  updateDriveUploadStatus();
  // 1. Upload video
  if (recordedBlobs.length) {
    const videoBlob = new Blob(recordedBlobs, { type: 'video/webm' });
    await uploadFileToDrive({
      name: `Exam_Video_${new Date().toISOString()}.webm`,
      mimeType: 'video/webm',
      data: await blobToBase64(videoBlob)
    });
  }
  // 2. Upload audio
  if (audioBlobs.length) {
    const audioBlob = new Blob(audioBlobs, { type: 'audio/webm' });
    await uploadFileToDrive({
      name: `Exam_Audio_${new Date().toISOString()}.webm`,
      mimeType: 'audio/webm',
      data: await blobToBase64(audioBlob)
    });
  }
  // 3. Upload alerts/logs
  const logBlob = new Blob([JSON.stringify(monitoringData, null, 2)], { type: 'application/json' });
  await uploadFileToDrive({
    name: `Exam_Alerts_${new Date().toISOString()}.json`,
    mimeType: 'application/json',
    data: await blobToBase64(logBlob)
  });
  driveUploadStatus = 'Upload complete!';
  updateDriveUploadStatus();
}

// Helper: Convert Blob to base64 for multipart upload
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // Remove the data:...;base64, prefix
      const base64 = reader.result.split(',')[1];
      resolve(atob(base64));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// UI: Show upload status
function updateDriveUploadStatus() {
  let statusDiv = document.getElementById('drive-upload-status');
  if (!statusDiv) {
    statusDiv = document.createElement('div');
    statusDiv.id = 'drive-upload-status';
    statusDiv.style.cssText = 'position:fixed;bottom:10px;right:10px;background:#fbbf24;color:#222;padding:8px 18px;border-radius:8px;z-index:9999;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.08);';
    document.body.appendChild(statusDiv);
  }
  statusDiv.textContent = driveUploadStatus;
  if (driveUploadStatus === 'Upload complete!') {
    setTimeout(() => { statusDiv.style.display = 'none'; }, 4000);
  } else {
    statusDiv.style.display = 'block';
  }
}

// ============= INTEGRATE WITH EXAM FLOW =============
// Start Google Drive auth and session recording at exam start
const _origStartExam = startExam;
startExam = async function() {
  // Show status UI
  driveUploadStatus = 'Loading Google Drive integration...';
  updateDriveUploadStatus();
  // Ensure gapi is loaded before proceeding
  let gapiTimeout;
  let gapiLoadFailed = false;
  try {
    // Wait for gapi to load, but timeout after 15s
    const gapiPromise = loadGapiClient();
    const timeoutPromise = new Promise((_, reject) => {
      gapiTimeout = setTimeout(() => {
        gapiLoadFailed = true;
        reject(new Error('Google API failed to load.'));
      }, 15000);
    });
    await Promise.race([gapiPromise, timeoutPromise]);
    clearTimeout(gapiTimeout);
  } catch (e) {
    driveUploadStatus = 'Google Drive integration failed to load.';
    updateDriveUploadStatus();
    showDriveRetryButton();
    return;
  }

  // Prompt for Drive access with timeout and error handling
  driveUploadStatus = 'Requesting Google Drive access...';
  updateDriveUploadStatus();
  let authTimeout;
  let authFailed = false;
  try {
    const authPromise = getDriveAccessToken();
    const timeoutPromise = new Promise((_, reject) => {
      authTimeout = setTimeout(() => {
        authFailed = true;
        reject(new Error('Google Drive authentication timed out.'));
      }, 15000);
    });
    await Promise.race([authPromise, timeoutPromise]);
    clearTimeout(authTimeout);
    driveUploadStatus = 'Google Drive access granted.';
    updateDriveUploadStatus();
  } catch (e) {
    let errorMsg = 'Google Drive access denied or failed! Upload will not work.';
    if (e && e.error) {
      errorMsg += ` Reason: ${e.error}`;
    } else if (e && e.message) {
      errorMsg += ` Reason: ${e.message}`;
    }
    driveUploadStatus = errorMsg;
    updateDriveUploadStatus();
    showDriveRetryButton();
    // Log the error to the console for debugging
    console.error('Google Drive OAuth error:', e);
    return;
  }
  // Start session recording
  await startSessionRecording();
  // Continue with normal exam start
  _origStartExam.apply(this, arguments);
};

// Show a retry button if Drive auth fails
function showDriveRetryButton() {
  let statusDiv = document.getElementById('drive-upload-status');
  if (!statusDiv) return;
  let retryBtn = document.getElementById('drive-retry-btn');
  if (!retryBtn) {
    retryBtn = document.createElement('button');
    retryBtn.id = 'drive-retry-btn';
    retryBtn.textContent = 'Retry Google Drive Access';
    retryBtn.style.cssText = 'margin-left:12px;padding:4px 12px;background:#f87171;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:600;';
    retryBtn.onclick = async function() {
      retryBtn.disabled = true;
      driveUploadStatus = 'Retrying Google Drive access...';
      updateDriveUploadStatus();
      // Remove button after click
      retryBtn.remove();
      // Try again
      await startExam();
    };
    statusDiv.appendChild(retryBtn);
  }
}

// Upload session data to Drive at exam end (when timer runs out)
const _origStartTimer = startTimer;
startTimer = function() {
  const timerElement = document.getElementById("timer");
  const interval = setInterval(() => {
    const minutes = Math.floor(examDuration / 60);
    const seconds = examDuration % 60;
    timerElement.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    examDuration--;
    if (examDuration < 0) {
      clearInterval(interval);
      stopSessionRecording();
      uploadSessionDataToDrive();
      alert("Time's up! Submitting exam and uploading session data...");
      document.getElementById("examForm").submit();
    }
  }, 1000);
};