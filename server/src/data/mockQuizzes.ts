/**
 * Mock vocabulary quiz data.
 * In production, this would come from a database or content management system.
 * These quizzes cover English vocabulary at varying difficulty levels.
 */

import type { Quiz } from '../quiz/types';

export const mockQuizzes: Quiz[] = [
  {
    id: 'vocab-101',
    title: 'English Vocabulary Basics',
    description: 'Test your knowledge of common English words and their meanings.',
    questions: [
      {
        id: 'q1',
        word: 'Ubiquitous',
        prompt: 'What does "ubiquitous" mean?',
        options: ['Extremely rare', 'Found everywhere', 'Very dangerous', 'Incredibly fast'],
        correctOptionIndex: 1,
        timeLimitSeconds: 15,
        difficulty: 'medium',
      },
      {
        id: 'q2',
        word: 'Ephemeral',
        prompt: 'Choose the correct meaning of "ephemeral":',
        options: [
          'Lasting for a very short time',
          'Extremely heavy',
          'Related to ancient history',
          'Causing great joy',
        ],
        correctOptionIndex: 0,
        timeLimitSeconds: 15,
        difficulty: 'medium',
      },
      {
        id: 'q3',
        word: 'Pragmatic',
        prompt: 'What does "pragmatic" mean?',
        options: [
          'Overly dramatic',
          'Related to grammar',
          'Dealing with things sensibly and realistically',
          'Extremely cautious',
        ],
        correctOptionIndex: 2,
        timeLimitSeconds: 15,
        difficulty: 'easy',
      },
      {
        id: 'q4',
        word: 'Eloquent',
        prompt: 'Select the definition of "eloquent":',
        options: [
          'Unable to speak',
          'Fluent and persuasive in speaking or writing',
          'Extremely quiet',
          'Related to electricity',
        ],
        correctOptionIndex: 1,
        timeLimitSeconds: 15,
        difficulty: 'easy',
      },
      {
        id: 'q5',
        word: 'Sycophant',
        prompt: 'What is a "sycophant"?',
        options: [
          'A type of musical instrument',
          'A person who acts obsequiously to gain advantage',
          'An ancient Greek philosopher',
          'A large elephant',
        ],
        correctOptionIndex: 1,
        timeLimitSeconds: 20,
        difficulty: 'hard',
      },
      {
        id: 'q6',
        word: 'Benevolent',
        prompt: 'Choose the correct meaning of "benevolent":',
        options: ['Harmful and dangerous', 'Well-meaning and kindly', 'Extremely wealthy', 'Relating to science'],
        correctOptionIndex: 1,
        timeLimitSeconds: 12,
        difficulty: 'easy',
      },
      {
        id: 'q7',
        word: 'Conundrum',
        prompt: 'What is a "conundrum"?',
        options: [
          'A type of drum',
          'A mathematical formula',
          'A confusing and difficult problem or question',
          'A large gathering of people',
        ],
        correctOptionIndex: 2,
        timeLimitSeconds: 15,
        difficulty: 'medium',
      },
      {
        id: 'q8',
        word: 'Aberration',
        prompt: 'Select the meaning of "aberration":',
        options: [
          'A departure from what is normal or expected',
          'A type of celebration',
          'An extremely loud noise',
          'A mathematical operation',
        ],
        correctOptionIndex: 0,
        timeLimitSeconds: 15,
        difficulty: 'hard',
      },
      {
        id: 'q9',
        word: 'Diligent',
        prompt: 'What does "diligent" mean?',
        options: [
          'Lazy and careless',
          'Extremely tall',
          "Having or showing care in one's work",
          'Relating to digital technology',
        ],
        correctOptionIndex: 2,
        timeLimitSeconds: 12,
        difficulty: 'easy',
      },
      {
        id: 'q10',
        word: 'Cacophony',
        prompt: 'What is a "cacophony"?',
        options: [
          'A beautiful melody',
          'A harsh, discordant mixture of sounds',
          'A type of telephone',
          'A collection of poems',
        ],
        correctOptionIndex: 1,
        timeLimitSeconds: 15,
        difficulty: 'medium',
      },
    ],
  },
  {
    id: 'vocab-201',
    title: 'Advanced English Vocabulary',
    description: 'Challenge yourself with advanced English vocabulary words.',
    questions: [
      {
        id: 'aq1',
        word: 'Perspicacious',
        prompt: 'What does "perspicacious" mean?',
        options: [
          'Having a ready insight into things',
          'Sweating profusely',
          'Being extremely cautious',
          'Relating to perspective drawing',
        ],
        correctOptionIndex: 0,
        timeLimitSeconds: 20,
        difficulty: 'hard',
      },
      {
        id: 'aq2',
        word: 'Obfuscate',
        prompt: 'Choose the meaning of "obfuscate":',
        options: [
          'To make clear and understandable',
          'To render obscure or unclear',
          'To celebrate loudly',
          'To move quickly',
        ],
        correctOptionIndex: 1,
        timeLimitSeconds: 20,
        difficulty: 'hard',
      },
      {
        id: 'aq3',
        word: 'Ameliorate',
        prompt: 'What does "ameliorate" mean?',
        options: ['To make worse', 'To combine together', 'To make something bad better', 'To melt slowly'],
        correctOptionIndex: 2,
        timeLimitSeconds: 20,
        difficulty: 'hard',
      },
      {
        id: 'aq4',
        word: 'Loquacious',
        prompt: 'A "loquacious" person is someone who:',
        options: ['Rarely speaks', 'Talks a great deal', 'Moves very slowly', 'Eats excessively'],
        correctOptionIndex: 1,
        timeLimitSeconds: 15,
        difficulty: 'medium',
      },
      {
        id: 'aq5',
        word: 'Recalcitrant',
        prompt: 'What does "recalcitrant" mean?',
        options: [
          'Eager to comply',
          'Having an unwillingness to obey',
          'Calculating carefully',
          'Repeating the same action',
        ],
        correctOptionIndex: 1,
        timeLimitSeconds: 20,
        difficulty: 'hard',
      },
    ],
  },
];

/**
 * Retrieve a quiz by its ID.
 * In production, this would query a database.
 */
export function getQuizById(quizId: string): Quiz | undefined {
  return mockQuizzes.find((q) => q.id === quizId);
}

/**
 * List all available quizzes (metadata only, no questions).
 */
export function listQuizzes(): Array<{ id: string; title: string; description: string; questionCount: number }> {
  return mockQuizzes.map((q) => ({
    id: q.id,
    title: q.title,
    description: q.description,
    questionCount: q.questions.length,
  }));
}
