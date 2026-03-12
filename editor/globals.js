'use strict';

// ── DOM Elements ───────────────────────────────────────────────
const loadingScreen = document.getElementById('loadingScreen');
const videoPlayer = document.getElementById('videoPlayer');
const playOverlay = document.getElementById('playOverlay');
const playPauseBtn = document.getElementById('playPauseBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const stopBtn = document.getElementById('stopBtn');
const timeDisplay = document.getElementById('timeDisplay');
const progressContainer = document.getElementById('progressContainer');
const progressFilled = document.getElementById('progressFilled');
const muteBtn = document.getElementById('muteBtn');
const volumeOnIcon = document.getElementById('volumeOnIcon');
const volumeOffIcon = document.getElementById('volumeOffIcon');
const volumeSlider = document.getElementById('volumeSlider');
const recordingInfo = document.getElementById('recordingInfo');
const videoSizeSlider = document.getElementById('videoSizeSlider');
const videoContainer = document.querySelector('.video-container');
const videoWrapper = document.querySelector('.video-wrapper');

// Timeline
const timeline = document.getElementById('timeline');
const timelineWaveform = document.getElementById('timelineWaveform');
const timelineSegmentsLayer = document.getElementById('timelineSegmentsLayer');
const timelineSplitsLayer = document.getElementById('timelineSplitsLayer');
const timelinePlayhead = document.getElementById('timelinePlayhead');
const timelineLabelStart = document.getElementById('timelineLabelStart');
const timelineLabelEnd = document.getElementById('timelineLabelEnd');

// Controls
const videoToolbar = document.getElementById('videoToolbar');
const splitBtn = document.getElementById('splitBtn');
const removeSectionBtn = document.getElementById('removeSectionBtn');
const deselectBtn = document.getElementById('deselectBtn');
const resetAllBtn = document.getElementById('resetAllBtn');
const editorInfo = document.getElementById('editorInfo');

// Actions
const downloadBtn = document.getElementById('downloadBtn');
const discardBtn = document.getElementById('discardBtn');
const processingOverlay = document.getElementById('processingOverlay');
const toast = document.getElementById('toast');

// Overlay Tracks DOM
const overlayCanvas = document.getElementById('overlayCanvas');
const overlayCtx = overlayCanvas.getContext('2d');
const overlayInteractionLayer = document.getElementById('overlayInteractionLayer');
const overlayTracksContainer = document.getElementById('overlayTracksContainer');
const addTrackBtn = document.getElementById('addTrackBtn');
const overlayEditPopover = document.getElementById('overlayEditPopover');
const popoverClose = document.getElementById('popoverClose');
const popoverText = document.getElementById('popoverText');
const popoverFontSize = document.getElementById('popoverFontSize');
const popoverColor = document.getElementById('popoverColor');
const popoverDuration = document.getElementById('popoverDuration');
const popoverX = document.getElementById('popoverX');
const popoverY = document.getElementById('popoverY');
const popoverSave = document.getElementById('popoverSave');

// ── State ──────────────────────────────────────────────────────
let videoBlob = null;
let videoDuration = 0;
let timelineDuration = 0;
let currentAppTime = 0;
let videoFileName = '';
let videoThumbnails = [];

// Split & delete state
let splitPoints = [];
let removedFlags = [];
let selectedSegIdx = null;
let isDraggingPlayhead = false;
let undoStack = [];

// Overlay Tracks State
let overlayTracks = [];
let overlayIdCounter = 0;
let editingOverlay = null;
let draggingOverlayItem = null;
let overlayImageCache = {};
let overlayAudioCache = {};
let activeAudioOverlays = new Set();

// Playback State
let isAppPlaying = false;
let isVirtualPlaying = false;
let virtualPlayInterval = null;
let lastRenderTime = 0;
let videoSyncRAF = null;
let wasPlayingBeforeDrag = false;

// Overlay Interaction & Audio Engine State
let editorAudioCtx = null;
let audioCtxReady = false;
const overlayAudioBuffers = {};
const activeAudioNodes = new Map();
let interactionDrag = null;
let selectedOverlayItem = null;
let toolbarInteracting = false;
let popoverBackdrop = null;
let pendingCutAction = null;
let resizingOverlayItem = null;