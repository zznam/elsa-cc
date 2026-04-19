/**
 * Client-side application logic for the Real-Time Vocabulary Quiz.
 * Handles Socket.IO communication and UI state management.
 */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────
  const state = {
    socket: null,
    userId: null,
    username: null,
    quizId: null,
    currentQuestionId: null,
    hasAnswered: false,
    timerInterval: null,
    timeLeft: 0,
    totalScore: 0,
    streak: 0,
  };

  // ─── DOM Elements ──────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const screens = {
    join: $('join-screen'),
    lobby: $('lobby-screen'),
    quiz: $('quiz-screen'),
    results: $('results-screen'),
  };

  // ─── Screen Management ─────────────────────────────────────
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ─── Socket.IO Setup ──────────────────────────────────────
  function initSocket() {
    state.socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000 });

    state.socket.on('connect', () => {
      $('connection-status').classList.remove('disconnected');
      $('connection-status').querySelector('.status-text').textContent = 'Connected';
    });

    state.socket.on('disconnect', () => {
      $('connection-status').classList.add('disconnected');
      $('connection-status').querySelector('.status-text').textContent = 'Disconnected';
    });

    // ─── Server Events ────────────────────────────────────
    state.socket.on('participant_joined', (data) => {
      addParticipantChip(data.userId, data.username);
    });

    state.socket.on('participant_left', (data) => {
      const chip = document.querySelector(`[data-user-id="${data.userId}"]`);
      if (chip) chip.remove();
    });

    state.socket.on('quiz_started', (data) => {
      showScreen('quiz');
    });

    state.socket.on('question', (data) => {
      showQuestion(data);
    });

    state.socket.on('question_timeout', (data) => {
      handleTimeout(data);
    });

    state.socket.on('leaderboard_update', (data) => {
      renderLeaderboard(data.entries);
    });

    state.socket.on('quiz_ended', (data) => {
      showResults(data);
    });

    state.socket.on('error', (data) => {
      console.error('Server error:', data);
    });
  }

  // ─── Load Quizzes ──────────────────────────────────────────
  async function loadQuizzes() {
    try {
      const res = await fetch('/api/quizzes');
      const quizzes = await res.json();
      const select = $('quiz-select');
      select.innerHTML = quizzes.map((q) => `<option value="${q.id}">${q.title} (${q.questionCount} questions)</option>`).join('');
      $('join-btn').disabled = false;
    } catch {
      $('quiz-select').innerHTML = '<option value="vocab-101">English Vocabulary Basics</option>';
      $('join-btn').disabled = false;
    }
  }

  // ─── Join Quiz ─────────────────────────────────────────────
  function joinQuiz() {
    const quizId = $('quiz-select').value;
    const username = $('username-input').value.trim();

    if (!username) {
      showError('Please enter your name');
      return;
    }

    $('join-btn').disabled = true;
    $('join-error').classList.add('hidden');

    state.socket.emit('join_quiz', { quizId, username }, (response) => {
      if (!response.success) {
        showError(response.error || 'Failed to join quiz');
        $('join-btn').disabled = false;
        return;
      }

      state.userId = response.userId;
      state.username = username;
      state.quizId = quizId;

      $('lobby-quiz-title').textContent = response.quizTitle;
      $('participants-list').innerHTML = '';
      (response.participants || []).forEach((p) => addParticipantChip(p.userId, p.username));

      if (response.state === 'ACTIVE' && response.currentQuestion) {
        showScreen('quiz');
        showQuestion(response.currentQuestion);
      } else {
        showScreen('lobby');
      }
    });
  }

  function showError(msg) {
    const el = $('join-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function addParticipantChip(userId, username) {
    if (document.querySelector(`[data-user-id="${userId}"]`)) return;
    const chip = document.createElement('div');
    chip.className = 'participant-chip';
    chip.dataset.userId = userId;
    chip.innerHTML = `<div class="participant-avatar">${username[0].toUpperCase()}</div><span>${username}</span>`;
    $('participants-list').appendChild(chip);
  }

  // ─── Start Quiz ────────────────────────────────────────────
  function startQuiz() {
    state.socket.emit('start_quiz', { quizId: state.quizId }, (response) => {
      if (!response.success) alert(response.error || 'Failed to start quiz');
    });
  }

  // ─── Question Display ─────────────────────────────────────
  function showQuestion(data) {
    state.currentQuestionId = data.questionId;
    state.hasAnswered = false;

    // Update progress
    const pct = ((data.questionNumber - 1) / data.totalQuestions) * 100;
    $('question-progress').style.width = pct + '%';
    $('question-counter').textContent = `${data.questionNumber} / ${data.totalQuestions}`;

    // Update question
    $('question-word').textContent = data.word;
    $('question-prompt').textContent = data.prompt;
    const badge = $('difficulty-badge');
    badge.textContent = data.difficulty;
    badge.className = 'difficulty-badge ' + data.difficulty;

    // Render options
    const labels = ['A', 'B', 'C', 'D'];
    $('options-grid').innerHTML = data.options.map((opt, i) =>
      `<button class="option-btn" data-index="${i}">
        <span class="option-label">${labels[i]}</span>
        <span>${opt}</span>
      </button>`
    ).join('');

    document.querySelectorAll('.option-btn').forEach((btn) => {
      btn.addEventListener('click', () => submitAnswer(parseInt(btn.dataset.index)));
    });

    // Hide feedback
    $('score-feedback').classList.add('hidden');

    // Start timer
    startTimer(data.timeLimitSeconds);
  }

  // ─── Timer ─────────────────────────────────────────────────
  function startTimer(seconds) {
    clearInterval(state.timerInterval);
    state.timeLeft = seconds;
    const circumference = 2 * Math.PI * 16; // r=16

    function updateTimer() {
      $('timer-text').textContent = state.timeLeft;
      const pct = state.timeLeft / seconds;
      $('timer-progress').style.strokeDashoffset = circumference * (1 - pct);

      const ring = $('timer-progress');
      ring.classList.remove('warning', 'danger');
      if (pct <= 0.25) ring.classList.add('danger');
      else if (pct <= 0.5) ring.classList.add('warning');
    }

    updateTimer();
    state.timerInterval = setInterval(() => {
      state.timeLeft--;
      if (state.timeLeft < 0) {
        clearInterval(state.timerInterval);
        return;
      }
      updateTimer();
    }, 1000);
  }

  // ─── Submit Answer ─────────────────────────────────────────
  function submitAnswer(selectedIndex) {
    if (state.hasAnswered) return;
    state.hasAnswered = true;
    clearInterval(state.timerInterval);

    // Highlight selected
    document.querySelectorAll('.option-btn').forEach((btn) => btn.classList.add('disabled'));
    document.querySelector(`[data-index="${selectedIndex}"]`).classList.add('selected');

    state.socket.emit('submit_answer', {
      quizId: state.quizId,
      questionId: state.currentQuestionId,
      selectedOptionIndex: selectedIndex,
      clientTimestamp: Date.now(),
    }, (response) => {
      if (!response.success) return;

      const r = response.result;
      // Highlight correct/incorrect
      document.querySelector(`[data-index="${r.correctOptionIndex}"]`).classList.add('correct');
      if (!r.correct) {
        document.querySelector(`[data-index="${selectedIndex}"]`).classList.add('incorrect');
      }

      state.totalScore = r.totalScore;
      state.streak = r.currentStreak;
      $('my-score').textContent = r.totalScore;

      // Show feedback
      const fb = $('score-feedback');
      fb.classList.remove('hidden');
      $('feedback-content').innerHTML = r.correct
        ? `<div class="feedback-correct">✅ Correct!</div>
           <div class="feedback-points">+${r.pointsEarned}</div>
           <div class="feedback-breakdown">
             <span>Base: ${r.basePoints}</span>
             <span>Time: +${r.timeBonus}</span>
             <span>Streak: +${r.streakBonus}</span>
           </div>
           ${r.currentStreak > 1 ? `<div class="feedback-streak">🔥 ${r.currentStreak} streak!</div>` : ''}`
        : `<div class="feedback-incorrect">❌ Incorrect</div>
           <div style="color:var(--text-secondary);margin-top:0.5rem">The correct answer was highlighted</div>`;
    });
  }

  // ─── Timeout ───────────────────────────────────────────────
  function handleTimeout(data) {
    if (!state.hasAnswered) {
      state.hasAnswered = true;
      clearInterval(state.timerInterval);
      document.querySelectorAll('.option-btn').forEach((b) => b.classList.add('disabled'));
      document.querySelector(`[data-index="${data.correctOptionIndex}"]`)?.classList.add('correct');

      const fb = $('score-feedback');
      fb.classList.remove('hidden');
      $('feedback-content').innerHTML = `<div class="feedback-incorrect">⏰ Time's up!</div>`;
    }
  }

  // ─── Leaderboard ───────────────────────────────────────────
  function renderLeaderboard(entries) {
    const list = $('leaderboard-list');
    if (!entries || entries.length === 0) {
      list.innerHTML = '<div class="leaderboard-empty">Waiting for scores...</div>';
      return;
    }

    list.innerHTML = entries.map((e) => {
      const isMe = e.userId === state.userId;
      const topClass = e.rank <= 3 ? ` top-${e.rank}` : '';
      const meClass = isMe ? ' is-me' : '';
      const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : e.rank;
      return `<div class="lb-entry${topClass}${meClass}">
        <span class="lb-rank">${medal}</span>
        <span class="lb-name">${isMe ? '⭐ ' + e.username : e.username}</span>
        <span class="lb-score">${e.score}</span>
      </div>`;
    }).join('');

    // Update my score bar
    const me = entries.find((e) => e.userId === state.userId);
    if (me) {
      $('my-rank').textContent = '#' + me.rank;
      $('my-name').textContent = me.username;
      $('my-score').textContent = me.score;
    }
  }

  // ─── Results ───────────────────────────────────────────────
  function showResults(data) {
    clearInterval(state.timerInterval);
    showScreen('results');

    const mins = Math.floor(data.durationSeconds / 60);
    const secs = data.durationSeconds % 60;
    $('results-duration').textContent = `Duration: ${mins}:${secs.toString().padStart(2, '0')}`;

    // Podium
    const entries = data.finalLeaderboard.entries;
    const medals = ['🥇', '🥈', '🥉'];
    const barClasses = ['gold', 'silver', 'bronze'];
    // Display order: 2nd, 1st, 3rd
    const order = [1, 0, 2];
    $('podium').innerHTML = order.map((i) => {
      const e = entries[i];
      if (!e) return '';
      return `<div class="podium-place">
        <div class="podium-medal">${medals[i]}</div>
        <div class="podium-name">${e.username}</div>
        <div class="podium-score">${e.score} pts</div>
        <div class="podium-bar ${barClasses[i]}"></div>
      </div>`;
    }).join('');

    // Full leaderboard
    $('final-leaderboard').innerHTML = entries.map((e, idx) => {
      const isMe = e.userId === state.userId;
      return `<div class="lb-entry${isMe ? ' is-me' : ''}">
        <span class="lb-rank">${e.rank}</span>
        <span class="lb-name">${e.username}</span>
        <span class="lb-score">${e.score}</span>
      </div>`;
    }).join('');
  }

  // ─── Event Listeners ──────────────────────────────────────
  $('join-btn').addEventListener('click', joinQuiz);
  $('username-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') joinQuiz(); });
  $('start-quiz-btn').addEventListener('click', startQuiz);
  $('play-again-btn').addEventListener('click', () => { location.reload(); });

  // ─── Init ──────────────────────────────────────────────────
  initSocket();
  loadQuizzes();
})();
