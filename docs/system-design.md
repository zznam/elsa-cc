# System Design Document — Real-Time Vocabulary Quiz

## 1. Architecture Overview

This system enables real-time vocabulary quiz sessions where multiple users can join simultaneously, answer questions, and see live leaderboard updates.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │  Web Client  │  │ Mobile App   │  │  Admin Panel │                  │
│  │  (HTML/JS)   │  │  (React Nat.)│  │  (Dashboard) │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         └──────────────────┼─────────────────┘                          │
│                    WebSocket (Socket.IO)                                 │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────────────┐
│                    LOAD BALANCER (NGINX)                                 │
│              Sticky sessions / WebSocket upgrade                        │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────────────┐
│                     APPLICATION LAYER                                    │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │              Node.js WebSocket Server Cluster                │        │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │        │
│  │  │  Instance 1   │  │  Instance 2   │  │  Instance N   │      │        │
│  │  │  Socket.IO    │  │  Socket.IO    │  │  Socket.IO    │      │        │
│  │  │  Express      │  │  Express      │  │  Express      │      │        │
│  │  └──────┬────────┘  └──────┬────────┘  └──────┬────────┘      │        │
│  └─────────┼──────────────────┼──────────────────┼───────────┘        │
│            └──────────────────┼──────────────────┘                     │
└───────────────────────────────┼──────────────────────────────────────┘
                                │
┌───────────────────────────────┼──────────────────────────────────────┐
│                        DATA LAYER                                     │
│  ┌──────────────────┐    ┌──────────────────┐                        │
│  │   Redis Cluster   │    │   PostgreSQL      │                        │
│  │  • Sorted Sets    │    │  • User profiles  │                        │
│  │    (Leaderboard)  │    │  • Quiz content   │                        │
│  │  • Pub/Sub        │    │  • Historical     │                        │
│  │    (Cross-node)   │    │    results         │                        │
│  │  • Session cache  │    │                    │                        │
│  └──────────────────┘    └──────────────────┘                        │
└──────────────────────────────────────────────────────────────────────┘
                                │
┌───────────────────────────────┼──────────────────────────────────────┐
│                    MONITORING LAYER                                    │
│  ┌──────────────────┐    ┌──────────────────┐                        │
│  │   Prometheus      │    │    Grafana        │                        │
│  │  • Metrics scrape │    │  • Dashboards     │                        │
│  │  • Alerts         │    │  • Visualization  │                        │
│  └──────────────────┘    └──────────────────┘                        │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. Component Descriptions

### Client Layer

- **Web Client**: Single-page app using vanilla HTML/CSS/JS with Socket.IO client. Handles quiz participation UI, real-time updates, and leaderboard display.
- **Mobile App** (future): React Native app sharing the same WebSocket protocol.
- **Admin Panel** (future): Dashboard for quiz management and analytics.

### Load Balancer (NGINX)

- Terminates SSL/TLS for `wss://` connections
- Routes WebSocket upgrade requests correctly
- **Sticky sessions** ensure WebSocket handshakes complete on the same instance
- Health-check-based routing to healthy instances

### Application Layer — Node.js WebSocket Server

The core server is composed of these modules:

| Module | Responsibility |
|--------|---------------|
| **SocketHandler** | Manages Socket.IO event handling — join, answer, leaderboard |
| **QuizManager** | Creates/manages quiz sessions, handles lifecycle and cleanup |
| **QuizSession** | State machine for individual quiz (WAITING → ACTIVE → FINISHED) |
| **ScoringEngine** | Server-side answer validation and score calculation (anti-cheat) |
| **LeaderboardService** | Interface for leaderboard storage (Redis or in-memory) |
| **RoomManager** | Maps socket connections to quiz rooms |

### Data Layer

**Redis** (hot path — real-time data):

- **Sorted Sets**: `ZINCRBY` for O(log N) atomic score updates, `ZREVRANGE` for top-N queries
- **Pub/Sub**: Cross-instance message broadcasting when horizontally scaled
- **Hash maps**: Username lookups keyed by user ID

**PostgreSQL** (cold path — persistent data):

- User profiles and authentication
- Quiz content (questions, categories)
- Historical results and analytics

### Monitoring Layer

- **Prometheus**: Scrapes `/metrics` endpoint for counters (connections, answers, errors), gauges (active sessions), and histograms (answer latency)
- **Grafana**: Visualizes dashboards for real-time operational awareness

## 3. Data Flow

### Flow: User joins a quiz → answers → leaderboard updates

```
User                  Server                    Redis            Clients
 │                      │                         │                 │
 │ 1. connect (WS)      │                         │                 │
 │─────────────────────>│                         │                 │
 │                      │                         │                 │
 │ 2. join_quiz         │                         │                 │
 │  {quizId, username}  │                         │                 │
 │─────────────────────>│                         │                 │
 │                      │ 3. Validate quiz exists  │                 │
 │                      │ 4. Create/get session    │                 │
 │                      │ 5. Add participant       │                 │
 │                      │ 6. Join Socket.IO room   │                 │
 │                      │────────────────────────>│                 │
 │                      │ 7. participant_joined    │                 │
 │                      │─────────────────────────────────────────>│
 │ 8. {userId, state}   │                         │                 │
 │<─────────────────────│                         │                 │
 │                      │                         │                 │
 │ 9. start_quiz        │                         │                 │
 │─────────────────────>│                         │                 │
 │                      │ 10. State → ACTIVE       │                 │
 │                      │ 11. question broadcast   │                 │
 │                      │─────────────────────────────────────────>│
 │ question (Q1)        │                         │                 │
 │<──────────────────────────────────────────────────────────────── │
 │                      │                         │                 │
 │ 12. submit_answer    │                         │                 │
 │  {questionId, idx}   │                         │                 │
 │─────────────────────>│                         │                 │
 │                      │ 13. Validate answer      │                 │
 │                      │ 14. Calculate score      │                 │
 │                      │     (time + streak bonus)│                 │
 │                      │ 15. ZINCRBY leaderboard  │                 │
 │                      │────────────────────────>│                 │
 │                      │ 16. ZREVRANGE top N      │                 │
 │                      │<────────────────────────│                 │
 │                      │ 17. leaderboard_update   │                 │
 │                      │─────────────────────────────────────────>│
 │ 18. {scoreResult}    │                         │                 │
 │<─────────────────────│                         │                 │
```

### Key Data Flow Details

1. **WebSocket connection** established on page load with auto-reconnection
2. **join_quiz** validates the quiz ID exists, creates a session if needed, assigns a UUID
3. **Question delivery** is push-based — server controls timing via internal timers
4. **Answer validation** is entirely server-side — client never knows the correct answer until after submission
5. **Score calculation** uses server-side timestamps to prevent timing manipulation
6. **Leaderboard broadcasts** are throttled (max once per 500ms) to prevent flooding

## 4. Technologies and Tools

| Technology | Purpose | Justification |
|-----------|---------|---------------|
| **Node.js** | Runtime | Non-blocking I/O ideal for concurrent WebSocket connections; single-threaded event loop handles thousands of connections efficiently |
| **TypeScript** | Language | Type safety catches bugs at compile time; self-documenting interfaces; better IDE support; expected for senior-level work |
| **Socket.IO** | WebSockets | Built-in rooms (quiz sessions), auto-reconnection, fallback to polling, Redis adapter for horizontal scaling |
| **Express** | HTTP | Serves static client files, health checks, and metrics endpoints alongside Socket.IO |
| **Redis** | Leaderboard + Pub/Sub | Sorted Sets provide O(log N) atomic score updates — purpose-built for leaderboards; Pub/Sub enables cross-instance broadcasting |
| **PostgreSQL** | Persistent DB | ACID compliance for quiz content and user data; mature ecosystem |
| **Zod** | Validation | Runtime type validation for all WebSocket payloads; auto-generates descriptive error messages |
| **Vitest** | Testing | Fast, ESM-native test runner with TypeScript support; compatible with Jest API |
| **Prometheus + Grafana** | Monitoring | Industry standard for metrics collection and visualization |

## 5. Scalability Considerations

| Concern | Solution | Trade-off |
|---------|----------|-----------|
| High concurrent users | Horizontal scaling with Socket.IO Redis adapter | Added Redis dependency; slightly higher latency |
| Leaderboard throughput | Redis Sorted Sets with throttled broadcasts | 500ms update delay acceptable for quiz UX |
| Cross-instance messaging | Redis Pub/Sub for broadcasting | Redis becomes single point of failure — mitigate with Redis Cluster |
| Connection limits | OS tuning (file descriptors), load balancer | Requires infrastructure configuration |
| Data consistency | Atomic Redis operations (ZINCRBY) | Eventually consistent with PostgreSQL persistence |
| Geographic distribution | Regional server deployments + CDN | Increased operational complexity |

## 6. Reliability & Error Handling

- **Graceful degradation**: Falls back from Redis to in-memory leaderboard if Redis is unavailable
- **Auto-reconnection**: Socket.IO client reconnects automatically with exponential backoff
- **Graceful shutdown**: SIGTERM handler drains connections before exit
- **Rate limiting**: Per-user answer throttling prevents abuse
- **Input validation**: Zod schemas validate all incoming data
- **Duplicate prevention**: Server tracks answered questions per user

## 7. Monitoring & Observability

- **Structured JSON logging** with context, correlation IDs, and log levels
- **Health endpoint** (`/health`) reports uptime, active sessions, connection count, memory usage
- **Metrics endpoint** (`/metrics`) exposes counters, gauges, histograms
- **Key metrics tracked**: active connections, answers submitted, correct answer rate, answer latency (p50/p95/p99), session count
