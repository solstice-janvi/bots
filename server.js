// server.js
require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Import for Gemini API

// Initialize Firebase Admin SDK
// This section handles parsing the Firebase service account key from environment variables.
// It prioritizes a Base64 encoded key for robustness, falling back to direct JSON parsing.
let serviceAccount;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64) {
        // Decode the Base64 string and then parse the JSON
        const decodedKey = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString('utf8');
        serviceAccount = JSON.parse(decodedKey);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        // Fallback to direct JSON parsing if Base64 version is not found (less robust for complex keys)
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    } else {
        throw new Error("Firebase service account key not found in environment variables. Please set FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 or FIREBASE_SERVICE_ACCOUNT_KEY.");
    }
} catch (error) {
    console.error("Error parsing Firebase service account key. Ensure it's correctly formatted and Base64 encoded if applicable:", error);
    // Exit the process as Firebase initialization is critical
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL // e.g., "https://your-project-id.firebaseio.com"
});

const db = admin.firestore(); // Initialize Firestore

// Initialize Twilio client
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Using "gemini-2.0-flash" as it's generally more broadly available for direct generateContent calls
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Helper function to send WhatsApp message
async function sendWhatsAppMessage(to, message) {
    try {
        await twilioClient.messages.create({
            body: message,
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`, // Your Twilio WhatsApp number
            to: `whatsapp:${to}`
        });
        console.log(`Message sent to ${to}: ${message}`);
    } catch (error) {
        console.error(`Error sending message to ${to}:`, error);
    }
}

// --- BOT HUB STATES & CONFIGURATION ---
const BOT_TYPES = {
    REVISION_BOT: 'exam_revision_bot',
    PDF_SUMMARIZER_BOT: 'pdf_summarizer_bot',
    TRANSLATOR_BOT: 'translator_bot',
    RESUME_GENERATOR_BOT: 'resume_generator_bot',
    LEGAL_SIMPLIFIER_BOT: 'legal_document_simplifier_bot',
    NEWS_DIGEST_BOT: 'daily_news_digest_bot',
    RECIPE_COACH_BOT: 'whatsapp_recipe_coach_bot',
    CAREER_COUNSELOR_BOT: 'ai_career_counselor_bot',
    YOUTUBE_SCRIPT_BOT: 'youtube_script_thumbnail_bot',
    LOCAL_SERVICES_BOT: 'local_services_finder_bot',
    FINANCE_REMINDER_BOT: 'personal_finance_bill_reminder_bot',
    INSTAGRAM_CAPTION_BOT: 'instagram_caption_hashtag_generator_bot',
    ORDER_TRACKING_BOT: 'ai_order_tracking_complaint_assistant',
    MENTAL_HEALTH_BOT: 'mental_health_journal_therapy_companion'
};

const MAIN_MENU_OPTIONS = {
    '1': BOT_TYPES.REVISION_BOT,
    '2': BOT_TYPES.RESUME_GENERATOR_BOT,
    '3': BOT_TYPES.LEGAL_SIMPLIFIER_BOT,
    '4': BOT_TYPES.NEWS_DIGEST_BOT,
    '5': BOT_TYPES.RECIPE_COACH_BOT,
    '6': BOT_TYPES.CAREER_COUNSELOR_BOT,
    '7': BOT_TYPES.YOUTUBE_SCRIPT_BOT,
    '8': BOT_TYPES.LOCAL_SERVICES_BOT,
    '9': BOT_TYPES.FINANCE_REMINDER_BOT,
    '10': BOT_TYPES.INSTAGRAM_CAPTION_BOT,
    '11': BOT_TYPES.ORDER_TRACKING_BOT,
    '12': BOT_TYPES.MENTAL_HEALTH_BOT,
    // Note: Translator bot is kept as a separate entry for now, but could be integrated if needed
    // '13': BOT_TYPES.TRANSLATOR_BOT // Removed from main menu for now to keep 12, can be added back
};


// User session states for the Exam Revision Bot
const REVISION_BOT_STATES = {
    AWAITING_EXAM_SELECTION: 'revision_awaiting_exam_selection',
    AWAITING_SUBJECT_SELECTION: 'revision_awaiting_subject_selection',
    MAIN_MENU: 'revision_main_menu', // Main menu for revision bot features
    IN_QUIZ: 'revision_in_quiz',
    AWAITING_QUIZ_ANSWER: 'revision_awaiting_quiz_answer',
    AWAITING_FLASHCARD_TOPIC: 'revision_awaiting_flashcard_topic',
    AWAITING_AI_QUIZ_TOPIC: 'revision_awaiting_ai_quiz_topic'
};

// User session states for Resume & Cover Letter Generator Bot
const RESUME_GENERATOR_STATES = {
    AWAITING_NAME: 'resume_awaiting_name',
    AWAITING_SKILLS: 'resume_awaiting_skills',
    AWAITING_GOALS: 'resume_awaiting_goals',
    CONFIRM_GENERATE: 'resume_confirm_generate'
};

// User session states for Legal Document Simplifier Bot
const LEGAL_SIMPLIFIER_STATES = {
    AWAITING_DOCUMENT_TEXT: 'legal_awaiting_document_text',
    AWAITING_LANGUAGE: 'legal_awaiting_language' // For explanation language
};

// User session states for Daily News Digest Bot
const NEWS_DIGEST_STATES = {
    AWAITING_FEED_PREFERENCE: 'news_awaiting_feed_preference',
    AWAITING_DELIVERY_TIME: 'news_awaiting_delivery_time' // For scheduling
};

// User session states for WhatsApp Recipe Coach Bot
const RECIPE_COACH_STATES = {
    AWAITING_INGREDIENTS: 'recipe_awaiting_ingredients',
    AWAITING_PHOTO_CONFIRMATION: 'recipe_awaiting_photo_confirmation'
};

// User session states for AI Career Counselor Bot
const CAREER_COUNSELOR_STATES = {
    AWAITING_INTERESTS: 'career_awaiting_interests',
    AWAITING_STREAM_GPA: 'career_awaiting_stream_gpa'
};

// User session states for YouTube Script & Thumbnail Bot
const YOUTUBE_SCRIPT_STATES = {
    AWAITING_VIDEO_IDEA: 'youtube_awaiting_video_idea'
};

// User session states for Local Services Finder Bot
const LOCAL_SERVICES_STATES = {
    AWAITING_CITY_SERVICE: 'local_awaiting_city_service'
};

// User session states for Personal Finance & Bill Reminder Bot
const FINANCE_REMINDER_STATES = {
    MAIN_MENU: 'finance_main_menu',
    AWAITING_BILL_TYPE: 'finance_awaiting_bill_type',
    AWAITING_DUE_DATE: 'finance_awaiting_due_date',
    AWAITING_AMOUNT: 'finance_awaiting_amount'
};

// User session states for Instagram Caption/Hashtag Generator Bot
const INSTAGRAM_CAPTION_STATES = {
    AWAITING_PHOTO_DESCRIPTION: 'insta_awaiting_photo_description'
};

// User session states for AI Order Tracking & Complaint Assistant (B2B)
const ORDER_TRACKING_STATES = {
    AWAITING_AWB: 'order_awaiting_awb',
    AWAITING_COMPLAINT_DETAILS: 'order_awaiting_complaint_details'
};

// User session states for Mental Health Journal & Therapy Companion
const MENTAL_HEALTH_STATES = {
    AWAITING_FEELINGS: 'mental_awaiting_feelings'
};

// User session states for Translator Bot (kept separate for clarity in this large file)
const TRANSLATOR_STATES = {
    AWAITING_TEXT: 'translator_awaiting_text',
    AWAITING_LANGUAGE: 'translator_awaiting_language'
};


// --- GLOBAL USER STATES FOR BOT HUB ---
const USER_STATES = {
    AWAITING_BOT_SELECTION: 'awaiting_bot_selection', // Top-level state
    // Other states will be managed within specific bot handlers
};


// Available exams and subjects (can be dynamic from Firestore later)
const EXAMS = {
    '1': 'JEE',
    '2': 'NEET',
    '3': 'UPSC',
    '4': 'CUET',
    '5': 'SSC CGL',
    '6': 'School Exams (Class 10)',
    '7': 'School Exams (Class 12)',
    '8': 'Bank PO/Clerk'
};

const SUBJECTS = {
    'JEE': {
        '1': 'Physics',
        '2': 'Chemistry',
        '3': 'Math',
        '4': 'Computer Science',
        '5': 'Biology (for Biotechnology)'
    },
    'NEET': {
        '1': 'Physics',
        '2': 'Chemistry',
        '3': 'Biology',
        '4': 'Botany',
        '5': 'Zoology'
    },
    'UPSC': {
        '1': 'History',
        '2': 'Geography',
        '3': 'Polity',
        '4': 'Economics',
        '5': 'Environment',
        '6': 'Science & Technology'
    },
    'CUET': {
        '1': 'General Test',
        '2': 'English',
        '3': 'Domain Specific',
        '4': 'Accountancy',
        '5': 'Business Studies',
        '6': 'Legal Studies'
    },
    'SSC CGL': {
        '1': 'General Intelligence & Reasoning',
        '2': 'General Awareness',
        '3': 'Quantitative Aptitude',
        '4': 'English Comprehension',
        '5': 'Computer Proficiency'
    },
    'School Exams (Class 10)': {
        '1': 'Mathematics',
        '2': 'Science',
        '3': 'Social Science',
        '4': 'English Language & Literature',
        '5': 'Hindi'
    },
    'School Exams (Class 12)': {
        '1': 'Physics',
        '2': 'Chemistry',
        '3': 'Mathematics',
        '4': 'Biology',
        '5': 'Computer Science',
        '6': 'Economics',
        '7': 'Business Studies',
        '8': 'Accountancy',
        '9': 'History',
        '10': 'Political Science'
    },
    'Bank PO/Clerk': {
        '1': 'Reasoning Ability',
        '2': 'Quantitative Aptitude',
        '3': 'English Language',
        '4': 'General Awareness',
        '5': 'Computer Knowledge'
    }
};

/**
 * Generates an explanation for an MCQ answer using Gemini.
 * @param {string} question The MCQ question.
 * @param {string[]} options The array of options.
 * @param {number} correctAnswerIndex The index of the correct answer.
 * @param {string} userAnswer The user's answer.
 * @returns {Promise<string>} The generated explanation.
 */
async function generateExplanation(question, options, correctAnswerIndex, userAnswer) {
    const correctOption = options[correctAnswerIndex];
    const prompt = `Given the following Multiple Choice Question:\nQuestion: ${question}\nOptions: ${options.map((opt, i) => `${String.fromCharCode(97 + i)}) ${opt}`).join('\n')}\n\nThe correct answer is ${String.fromCharCode(97 + correctAnswerIndex)}) ${correctOption}. The user answered: "${userAnswer}".\n\nPlease provide a concise explanation (around 50-70 words) for the correct answer, and briefly explain why the other options are incorrect if applicable. Start with whether the user's answer was correct or incorrect.`;

    try {
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error('Error generating explanation with Gemini:', error);
        return 'I am unable to generate an explanation at this moment. Please try again later.';
    }
}

/**
 * Generates flashcards or a summary for a given topic using Gemini.
 * @param {string} topic The subject/topic for which to generate content.
 * @param {string} type 'flashcards' or 'summary'.
 * @returns {Promise<string>} The generated content.
 */
async function generateRevisionContent(topic, type) {
    let prompt;
    if (type === 'flashcards') {
        prompt = `Generate 3-5 concise flashcards for the topic "${topic}". Each flashcard should have a question and an answer. Format them clearly, e.g., "Q: ...\nA: ...\n\nQ: ...\nA: ..."`;
    } else { // summary
        prompt = `Provide a concise summary (around 100-150 words) of the topic "${topic}", highlighting key concepts.`;
    }

    try {
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error('Error generating revision content with Gemini:', error);
        return 'I am unable to generate revision content at this moment. Please try again later.';
    }
}

/**
 * Generates a quiz (3 MCQs) for a given topic using Gemini.
 * @param {string} examType The selected exam type.
 * @param {string} subject The selected subject.
 * @param {string} topic The specific topic for the quiz.
 * @returns {Promise<Array>} An array of MCQ objects.
 */
async function generateAIQuiz(examType, subject, topic) {
    const prompt = `Generate 3 multiple-choice questions for the ${examType} exam, subject ${subject}, on the topic "${topic}". Each question should have 4 options (a, b, c, d) and indicate the correct answer. Provide the output as a JSON array of objects, where each object has 'question', 'options' (an array of strings), and 'correctAnswerIndex' (0-3).`;

    const generationConfig = {
        responseMimeType: "application/json",
        responseSchema: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    "question": { "type": "STRING" },
                    "options": {
                        "type": "ARRAY",
                        "items": { "type": "STRING" }
                    },
                    "correctAnswerIndex": { "type": "NUMBER" }
                },
                "required": ["question", "options", "correctAnswerIndex"]
            }
        }
    };

    try {
        const result = await geminiModel.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: generationConfig
        });
        const responseText = result.response.text();
        const parsedQuiz = JSON.parse(responseText);

        // Add examType and subject to each question for consistency with Firestore structure
        return parsedQuiz.map(q => ({
            ...q,
            examType: examType,
            subject: subject,
            topic: topic // Add topic for context
        }));
    } catch (error) {
        console.error('Error generating AI quiz with Gemini:', error);
        return []; // Return empty array on error
    }
}

// --- SUB-BOT HANDLERS ---

/**
 * Handles messages when the user is interacting with the Exam Revision Bot.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleRevisionBotMessage(incomingMsg, userData) {
    let responseMessage = '';
    switch (userData.sessionState) {
        case REVISION_BOT_STATES.AWAITING_EXAM_SELECTION:
            if (EXAMS[incomingMsg]) {
                userData.examType = EXAMS[incomingMsg];
                userData.sessionState = REVISION_BOT_STATES.AWAITING_SUBJECT_SELECTION;
                const subjectOptions = Object.keys(SUBJECTS[userData.examType]).map(key => `${key}️⃣ ${SUBJECTS[userData.examType][key]}`).join('\n');
                responseMessage = `➡️ You selected ${userData.examType}!\nWhich subject?\n${subjectOptions}`;
            } else {
                const examOptions = Object.keys(EXAMS).map(key => `${key}️⃣ ${EXAMS[key]}`).join('\n');
                responseMessage = `Please choose a number from the list:\n${examOptions}`;
            }
            break;

        case REVISION_BOT_STATES.AWAITING_SUBJECT_SELECTION:
            if (userData.examType && SUBJECTS[userData.examType] && SUBJECTS[userData.examType][incomingMsg]) {
                userData.subject = SUBJECTS[userData.examType][incomingMsg];
                userData.sessionState = REVISION_BOT_STATES.MAIN_MENU;
                responseMessage = `➡️ You selected ${userData.subject}.\nWant a *quiz* (generated by AI) or *flashcards* today?\n👉 Type: *quiz* or *flashcards*`;
            } else {
                const subjectOptions = Object.keys(SUBJECTS[userData.examType]).map(key => `${key}️⃣ ${SUBJECTS[userData.examType][key]}`).join('\n');
                responseMessage = `Please select a valid subject for ${userData.examType}:\n${subjectOptions}`;
            }
            break;

        case REVISION_BOT_STATES.MAIN_MENU:
            if (incomingMsg === 'quiz') {
                userData.sessionState = REVISION_BOT_STATES.AWAITING_AI_QUIZ_TOPIC;
                responseMessage = `Great! For your quiz, which specific topic in ${userData.subject} would you like questions on? (e.g., Thermodynamics, Indian History, etc.)`;
            } else if (incomingMsg === 'flashcards') {
                userData.sessionState = REVISION_BOT_STATES.AWAITING_FLASHCARD_TOPIC;
                responseMessage = `Great! Which specific topic in ${userData.subject} would you like flashcards or a summary for? (e.g., Thermodynamics, Optics, etc.)`;
            } else if (incomingMsg === 'change exam' || incomingMsg === 'change subject') {
                userData.examType = null;
                userData.subject = null;
                userData.sessionState = REVISION_BOT_STATES.AWAITING_EXAM_SELECTION;
                const examOptions = Object.keys(EXAMS).map(key => `${key}️⃣ ${EXAMS[key]}`).join('\n');
                responseMessage = `Okay, let's start over with the Exam Revision Bot. Which exam are you preparing for?\n${examOptions}`;
            } else {
                responseMessage = `I didn't understand that. Please type *quiz*, *flashcards*, *change exam*, or *change subject*.`;
            }
            break;

        case REVISION_BOT_STATES.AWAITING_AI_QUIZ_TOPIC:
            const aiQuizTopic = incomingMsg;
            const aiQuestions = await generateAIQuiz(userData.examType, userData.subject, aiQuizTopic);

            if (aiQuestions.length > 0) {
                userData.currentQuiz.questionIds = aiQuestions.map(q => ({ data: q })); // AI questions don't have Firestore IDs
                userData.currentQuiz.currentQIndex = 0;
                userData.currentQuiz.score = 0;
                userData.sessionState = REVISION_BOT_STATES.IN_QUIZ;

                const firstAIQuestion = userData.currentQuiz.questionIds[0].data;
                userData.currentQuiz.lastQuestionSent = firstAIQuestion;
                responseMessage = `🧠 Here's your quiz on "${aiQuizTopic}"!\n\n🔹 Quiz Q${userData.currentQuiz.currentQIndex + 1}: ${firstAIQuestion.question}\n${firstAIQuestion.options.map((opt, i) => `${String.fromCharCode(97 + i)}) ${opt}`).join('\n')}`;
                userData.sessionState = REVISION_BOT_STATES.AWAITING_QUIZ_ANSWER;
            } else {
                responseMessage = `Sorry, I couldn't generate a quiz for "${aiQuizTopic}". Please try a different topic or try again later.`;
                userData.sessionState = REVISION_BOT_STATES.MAIN_MENU; // Go back to main menu
            }
            break;

        case REVISION_BOT_STATES.AWAITING_QUIZ_ANSWER:
            const currentQuestionData = userData.currentQuiz.lastQuestionSent;
            if (!currentQuestionData) {
                responseMessage = "It seems there was an issue with the last question. Let's try starting a new quiz. Type *quiz* to begin.";
                userData.sessionState = REVISION_BOT_STATES.MAIN_MENU;
                break;
            }

            const userAnswerIndex = incomingMsg.charCodeAt(0) - 97; // 'a' -> 0, 'b' -> 1, etc.
            const isCorrect = (userAnswerIndex === currentQuestionData.correctAnswerIndex);

            let explanation = await generateExplanation(
                currentQuestionData.question,
                currentQuestionData.options,
                currentQuestionData.correctAnswerIndex,
                currentQuestionData.options[userAnswerIndex] || incomingMsg
            );

            if (isCorrect) {
                userData.currentQuiz.score++;
                responseMessage = `✅ Correct! ${explanation}`;
            } else {
                responseMessage = `❌ Incorrect. ${explanation}`;
            }

            userData.currentQuiz.currentQIndex++;

            if (userData.currentQuiz.currentQIndex < userData.currentQuiz.questionIds.length) {
                const nextQuestion = userData.currentQuiz.questionIds[userData.currentQuiz.currentQIndex].data;
                userData.currentQuiz.lastQuestionSent = nextQuestion;
                responseMessage += `\n\n🔹 Quiz Q${userData.currentQuiz.currentQIndex + 1}: ${nextQuestion.question}\n${nextQuestion.options.map((opt, i) => `${String.fromCharCode(97 + i)}) ${opt}`).join('\n')}`;
                userData.sessionState = REVISION_BOT_STATES.AWAITING_QUIZ_ANSWER;
            } else {
                responseMessage += `\n\n🎉 Quiz finished! You scored ${userData.currentQuiz.score} out of ${userData.currentQuiz.questionIds.length}.\n\nWhat next? Type *quiz* for another, *flashcards* for revision, or *change exam* / *change subject*.`;
                userData.sessionState = REVISION_BOT_STATES.MAIN_MENU;
                userData.currentQuiz = {
                    questionIds: [],
                    currentQIndex: 0,
                    score: 0,
                    lastQuestionSent: null,
                    lastAnswerCorrect: null
                };
            }
            break;

        case REVISION_BOT_STATES.AWAITING_FLASHCARD_TOPIC:
            const topic = incomingMsg;
            let contentType = 'flashcards';
            if (topic.includes('summary')) {
                contentType = 'summary';
            }

            const revisionContent = await generateRevisionContent(topic, contentType);
            responseMessage = `Here's your ${contentType} for "${topic}":\n\n${revisionContent}\n\nWhat next? Type *quiz* for a quiz, *flashcards* for more revision, or *change exam* / *change subject*.`;
            userData.sessionState = REVISION_BOT_STATES.MAIN_MENU;
            break;

        default:
            const examOptions = Object.keys(EXAMS).map(key => `${key}️⃣ ${EXAMS[key]}`).join('\n');
            responseMessage = `Welcome to the Exam Revision Bot! Which exam are you preparing for?\n${examOptions}`;
            userData.sessionState = REVISION_BOT_STATES.AWAITING_EXAM_SELECTION;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the Resume & Cover Letter Generator Bot.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleResumeBotMessage(incomingMsg, userData) {
    let responseMessage = '';
    // Initialize resumeData if not present
    userData.resumeData = userData.resumeData || {};

    switch (userData.sessionState) {
        case RESUME_GENERATOR_STATES.AWAITING_NAME:
            userData.resumeData.name = incomingMsg;
            userData.sessionState = RESUME_GENERATOR_STATES.AWAITING_SKILLS;
            responseMessage = `Great, ${userData.resumeData.name}! Now, please list your key skills (e.g., JavaScript, Python, Marketing, Communication).`;
            break;
        case RESUME_GENERATOR_STATES.AWAITING_SKILLS:
            userData.resumeData.skills = incomingMsg;
            userData.sessionState = RESUME_GENERATOR_STATES.AWAITING_GOALS;
            responseMessage = `Got it. What are your career goals or the type of job you're seeking?`;
            break;
        case RESUME_GENERATOR_STATES.AWAITING_GOALS:
            userData.resumeData.goals = incomingMsg;
            userData.sessionState = RESUME_GENERATOR_STATES.CONFIRM_GENERATE;
            responseMessage = `Okay, I have your name: ${userData.resumeData.name}, skills: ${userData.resumeData.skills}, and goals: ${userData.resumeData.goals}.\n\nReady to generate your resume and cover letter? Type *yes* to proceed or *start over* to re-enter details.`;
            break;
        case RESUME_GENERATOR_STATES.CONFIRM_GENERATE:
            if (incomingMsg === 'yes') {
                const prompt = `Generate a concise resume summary and a short cover letter based on the following information:\nName: ${userData.resumeData.name}\nSkills: ${userData.resumeData.skills}\nGoals/Job Type: ${userData.resumeData.goals}\n\nFormat the output clearly with "Resume Summary:" and "Cover Letter:" sections.`;
                try {
                    const result = await geminiModel.generateContent(prompt);
                    const response = await result.response;
                    responseMessage = `Here's your generated content:\n\n${response.text().trim()}\n\n(Note: Actual PDF generation is a complex feature and would require further development.)\n\nType *main menu* to return to bot selection or *start over* for a new resume.`;
                    // Reset resume data after generation
                    userData.resumeData = {};
                } catch (error) {
                    console.error('Error generating resume/cover letter with Gemini:', error);
                    responseMessage = 'Sorry, I could not generate the resume/cover letter at this time. Please try again.';
                }
            } else if (incomingMsg === 'start over') {
                userData.resumeData = {};
                userData.sessionState = RESUME_GENERATOR_STATES.AWAITING_NAME;
                responseMessage = `Okay, let's start fresh. What is your full name?`;
            } else {
                responseMessage = `Please type *yes* to generate or *start over* to re-enter details.`;
            }
            break;
        default:
            responseMessage = `Welcome to the Resume & Cover Letter Generator Bot! What is your full name?`;
            userData.sessionState = RESUME_GENERATOR_STATES.AWAITING_NAME;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the Legal Document Simplifier Bot.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleLegalSimplifierMessage(incomingMsg, userData) {
    let responseMessage = '';
    // Initialize legalData if not present
    userData.legalData = userData.legalData || {};

    switch (userData.sessionState) {
        case LEGAL_SIMPLIFIER_STATES.AWAITING_DOCUMENT_TEXT:
            userData.legalData.documentText = incomingMsg;
            userData.sessionState = LEGAL_SIMPLIFIER_STATES.AWAITING_LANGUAGE;
            responseMessage = `Got it. In which language would you like the explanation? (e.g., *English*, *Hindi*)`;
            break;
        case LEGAL_SIMPLIFIER_STATES.AWAITING_LANGUAGE:
            const targetLanguage = incomingMsg;
            const documentText = userData.legalData.documentText;

            if (!documentText) {
                responseMessage = `It seems I lost the document text. Please send the document text again.`;
                userData.sessionState = LEGAL_SIMPLIFIER_STATES.AWAITING_DOCUMENT_TEXT;
                break;
            }

            const prompt = `Simplify and explain the following legal text in plain ${targetLanguage}. Also, highlight any potential risks or scams. Keep the explanation concise and easy to understand:\n\n"${documentText}"`;
            try {
                const result = await geminiModel.generateContent(prompt);
                const response = await result.response;
                responseMessage = `Here's the simplified explanation in ${targetLanguage}:\n\n${response.text().trim()}\n\nSend another document to simplify, or type 'main menu' to go back.`;
                userData.sessionState = LEGAL_SIMPLIFIER_STATES.AWAITING_DOCUMENT_TEXT; // Ready for next document
                userData.legalData = {}; // Clear document data
            } catch (error) {
                console.error('Error simplifying legal document with Gemini:', error);
                responseMessage = 'Sorry, I could not simplify that document. Please try again.';
                userData.sessionState = LEGAL_SIMPLIFIER_STATES.AWAITING_DOCUMENT_TEXT;
            }
            break;
        default:
            responseMessage = `Welcome to the Legal Document Simplifier Bot! Please paste the legal document or text you want me to explain.`;
            userData.sessionState = LEGAL_SIMPLIFIER_STATES.AWAITING_DOCUMENT_TEXT;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the Daily News Digest Bot.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleNewsDigestMessage(incomingMsg, userData) {
    let responseMessage = '';
    switch (userData.sessionState) {
        case NEWS_DIGEST_STATES.AWAITING_FEED_PREFERENCE:
            // Placeholder: Logic to set user's news preferences
            // In a real bot, you'd have options like "Politics", "Tech", "Cricket"
            // and save them to userData.newsPreferences
            userData.newsPreferences = incomingMsg; // Simple save for now
            userData.sessionState = NEWS_DIGEST_STATES.AWAITING_DELIVERY_TIME;
            responseMessage = `Got it. You're interested in "${incomingMsg}" news. What time (e.g., 8 AM, 6 PM IST) would you like to receive your daily digest?`;
            break;
        case NEWS_DIGEST_STATES.AWAITING_DELIVERY_TIME:
            // Placeholder: Logic to store delivery time and activate scheduler
            userData.deliveryTime = incomingMsg;
            responseMessage = `Okay, your daily news digest for "${userData.newsPreferences}" will be delivered around ${userData.deliveryTime}. (Note: Scheduling requires a cron job or cloud function setup.)\n\nType 'main menu' to go back.`;
            // In a real system, you'd store this in Firestore and have a separate cron job
            // that queries users with delivery times and sends digests.
            userData.newsPreferences = null; // Clear for next setup
            userData.deliveryTime = null;
            break;
        default:
            responseMessage = `Welcome to the Daily News Digest Bot! What kind of news are you interested in? (e.g., *Politics*, *Tech*, *Cricket*, *Finance*)`;
            userData.sessionState = NEWS_DIGEST_STATES.AWAITING_FEED_PREFERENCE;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the WhatsApp Recipe Coach Bot.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleRecipeCoachMessage(incomingMsg, userData) {
    let responseMessage = '';
    switch (userData.sessionState) {
        case RECIPE_COACH_STATES.AWAITING_INGREDIENTS:
            // Check if it's an image message (Twilio sends image URLs in req.body.MediaUrlX)
            if (req.body.NumMedia > 0 && req.body.MediaUrl0) {
                responseMessage = `I received an image! For a real recipe coach, I'd analyze this food photo to suggest dishes. (Image analysis feature is complex and under development.)\n\nMeanwhile, please list the ingredients you have, or type 'main menu'.`;
                // In a real scenario, you'd use a vision model (like Gemini Pro Vision)
                // const imageUrl = req.body.MediaUrl0;
                // const recipeSuggestion = await analyzeImageForRecipe(imageUrl);
                // responseMessage = `Based on your photo, how about ${recipeSuggestion}?`;
            } else {
                const ingredients = incomingMsg;
                const prompt = `Suggest a simple recipe using the following ingredients: ${ingredients}. Also, mention any regional cuisine if applicable.`;
                try {
                    const result = await geminiModel.generateContent(prompt);
                    const response = await result.response;
                    responseMessage = `Here's a recipe idea for you:\n\n${response.text().trim()}\n\nSend more ingredients for another recipe, or type 'main menu' to go back.`;
                } catch (error) {
                    console.error('Error generating recipe with Gemini:', error);
                    responseMessage = 'Sorry, I could not suggest a recipe. Please try again.';
                }
            }
            break;
        default:
            responseMessage = `Welcome to the WhatsApp Recipe Coach Bot! Tell me what ingredients you have (e.g., "potato, onion, turmeric") or send a food photo.`;
            userData.sessionState = RECIPE_COACH_STATES.AWAITING_INGREDIENTS;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the AI Career Counselor Bot.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleCareerCounselorMessage(incomingMsg, userData) {
    let responseMessage = '';
    userData.careerData = userData.careerData || {};

    switch (userData.sessionState) {
        case CAREER_COUNSELOR_STATES.AWAITING_INTERESTS:
            userData.careerData.interests = incomingMsg;
            userData.sessionState = CAREER_COUNSELOR_STATES.AWAITING_STREAM_GPA;
            responseMessage = `Got it. What's your academic stream (e.g., Science, Commerce, Arts) and approximate GPA/percentage?`;
            break;
        case CAREER_COUNSELOR_STATES.AWAITING_STREAM_GPA:
            userData.careerData.streamGpa = incomingMsg;
            const prompt = `Based on these interests: ${userData.careerData.interests} and academic background: ${userData.careerData.streamGpa}, suggest suitable career paths or higher education degrees. Mention potential salary ranges and demand trends if possible.`;
            try {
                const result = await geminiModel.generateContent(prompt);
                const response = await result.response;
                responseMessage = `Here are some career and degree suggestions for you:\n\n${response.text().trim()}\n\n(Note: Real-time salary/demand data would require external APIs.)\n\nType 'main menu' to go back or send your interests again for new suggestions.`;
                userData.careerData = {}; // Clear for next query
                userData.sessionState = CAREER_COUNSELOR_STATES.AWAITING_INTERESTS;
            } catch (error) {
                console.error('Error generating career advice with Gemini:', error);
                responseMessage = 'Sorry, I could not generate career advice. Please try again.';
                userData.sessionState = CAREER_COUNSELOR_STATES.AWAITING_INTERESTS;
            }
            break;
        default:
            responseMessage = `Welcome to the AI Career Counselor Bot! Tell me about your interests (e.g., "coding, writing, helping people").`;
            userData.sessionState = CAREER_COUNSELOR_STATES.AWAITING_INTERESTS;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the YouTube Script & Thumbnail Bot.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleYoutubeScriptBotMessage(incomingMsg, userData) {
    let responseMessage = '';
    switch (userData.sessionState) {
        case YOUTUBE_SCRIPT_STATES.AWAITING_VIDEO_IDEA:
            const videoIdea = incomingMsg;
            const prompt = `Generate a YouTube video script outline (with intro, main points, CTA, and tags) and 3 thumbnail text suggestions for the video idea: "${videoIdea}".`;
            try {
                const result = await geminiModel.generateContent(prompt);
                const response = await result.response;
                responseMessage = `Here are some ideas for your video:\n\n${response.text().trim()}\n\nSend another video idea, or type 'main menu' to go back.`;
            } catch (error) {
                console.error('Error generating YouTube content with Gemini:', error);
                responseMessage = 'Sorry, I could not generate content for your video idea. Please try again.';
            }
            break;
        default:
            responseMessage = `Welcome to the YouTube Script & Thumbnail Bot! What's your video idea?`;
            userData.sessionState = YOUTUBE_SCRIPT_STATES.AWAITING_VIDEO_IDEA;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the Local Services Finder Bot.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleLocalServicesMessage(incomingMsg, userData) {
    let responseMessage = '';
    switch (userData.sessionState) {
        case LOCAL_SERVICES_STATES.AWAITING_CITY_SERVICE:
            // Example input: "Mehndi artist in Gwalior"
            const [service, city] = incomingMsg.toLowerCase().split(' in ');
            if (service && city) {
                responseMessage = `Searching for "${service}" in "${city}"...\n\n(Note: This feature requires a database of local providers or integration with a local search API, which is under development.)\n\nSend another city and service, or type 'main menu' to go back.`;
                // In a real scenario, you'd query a Firestore collection or external API
                // db.collection('local_providers').where('service', '==', service).where('city', '==', city).get();
            } else {
                responseMessage = `Please tell me the service and city, like "Mehndi artist in Gwalior".`;
            }
            break;
        default:
            responseMessage = `Welcome to the Local Services Finder Bot! Tell me what service you need and in which city (e.g., "Plumber in Delhi", "Electrician in Mumbai").`;
            userData.sessionState = LOCAL_SERVICES_STATES.AWAITING_CITY_SERVICE;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the Personal Finance & Bill Reminder Bot.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleFinanceReminderMessage(incomingMsg, userData) {
    let responseMessage = '';
    userData.financeData = userData.financeData || {};

    switch (userData.sessionState) {
        case FINANCE_REMINDER_STATES.MAIN_MENU:
            if (incomingMsg === 'add bill') {
                userData.sessionState = FINANCE_REMINDER_STATES.AWAITING_BILL_TYPE;
                responseMessage = `What type of bill is it? (e.g., *Credit Card*, *Rent*, *EMI*, *SIP*)`;
            } else if (incomingMsg === 'tips') {
                const prompt = `Provide 3 basic savings or loan tips for a middle-class professional.`;
                try {
                    const result = await geminiModel.generateContent(prompt);
                    const response = await result.response;
                    responseMessage = `Here are some financial tips:\n\n${response.text().trim()}\n\nType 'add bill' to add a reminder, 'tips' for more tips, or 'main menu' to go back.`;
                } catch (error) {
                    console.error('Error generating finance tips with Gemini:', error);
                    responseMessage = 'Sorry, I could not generate financial tips. Please try again.';
                }
            } else {
                responseMessage = `I didn't understand that. Type *add bill* to set a reminder or *tips* for financial advice.`;
            }
            break;
        case FINANCE_REMINDER_STATES.AWAITING_BILL_TYPE:
            userData.financeData.billType = incomingMsg;
            userData.sessionState = FINANCE_REMINDER_STATES.AWAITING_DUE_DATE;
            responseMessage = `What is the due date for your ${userData.financeData.billType}? (e.g., *25th of every month*, *2025-07-30*)`;
            break;
        case FINANCE_REMINDER_STATES.AWAITING_DUE_DATE:
            userData.financeData.dueDate = incomingMsg;
            userData.sessionState = FINANCE_REMINDER_STATES.AWAITING_AMOUNT;
            responseMessage = `What is the amount for your ${userData.financeData.billType} due on ${userData.financeData.dueDate}? (e.g., *₹5000*)`;
            break;
        case FINANCE_REMINDER_STATES.AWAITING_AMOUNT:
            userData.financeData.amount = incomingMsg;
            // Placeholder: Save reminder to Firestore
            // db.collection('reminders').add({ userId: userData.whatsappNumber, ...userData.financeData });
            responseMessage = `Got it! I'll remind you about your ${userData.financeData.billType} of ${userData.financeData.amount} due on ${userData.financeData.dueDate}. (Note: Actual reminders require a scheduler setup.)\n\nType 'add bill' to add another, 'tips' for advice, or 'main menu' to go back.`;
            userData.financeData = {}; // Clear for next reminder
            userData.sessionState = FINANCE_REMINDER_STATES.MAIN_MENU;
            break;
        default:
            responseMessage = `Welcome to the Personal Finance & Bill Reminder Bot! Type *add bill* to set a reminder or *tips* for financial advice.`;
            userData.sessionState = FINANCE_REMINDER_STATES.MAIN_MENU;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the Instagram Caption/Hashtag Generator Bot.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleInstagramCaptionMessage(incomingMsg, userData) {
    let responseMessage = '';
    switch (userData.sessionState) {
        case INSTAGRAM_CAPTION_STATES.AWAITING_PHOTO_DESCRIPTION:
            // Check if it's an image message (Twilio sends image URLs in req.body.MediaUrlX)
            if (req.body.NumMedia > 0 && req.body.MediaUrl0) {
                responseMessage = `I received an image! For a real caption generator, I'd analyze this photo. (Image analysis feature is complex and under development.)\n\nMeanwhile, please describe your photo or content for caption ideas.`;
                // In a real scenario, you'd use a vision model (like Gemini Pro Vision)
                // const imageUrl = req.body.MediaUrl0;
                // const description = await analyzeImageForDescription(imageUrl);
                // const prompt = `Generate Instagram caption ideas and trending hashtags for a photo described as: "${description}"`;
            } else {
                const photoDescription = incomingMsg;
                const prompt = `Generate 3-5 Instagram caption ideas, 5-7 trending hashtags, and 2-3 emoji suggestions for a photo described as: "${photoDescription}".`;
                try {
                    const result = await geminiModel.generateContent(prompt);
                    const response = await result.response;
                    responseMessage = `Here are some Instagram ideas for "${photoDescription}":\n\n${response.text().trim()}\n\nSend another description, or type 'main menu' to go back.`;
                } catch (error) {
                    console.error('Error generating Instagram content with Gemini:', error);
                    responseMessage = 'Sorry, I could not generate Instagram content. Please try again.';
                }
            }
            break;
        default:
            responseMessage = `Welcome to the Instagram Caption/Hashtag Generator Bot! Describe your photo or content (e.g., "sunset at beach", "new product launch").`;
            userData.sessionState = INSTAGRAM_CAPTION_STATES.AWAITING_PHOTO_DESCRIPTION;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the AI Order Tracking & Complaint Assistant (B2B).
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleOrderTrackingMessage(incomingMsg, userData) {
    let responseMessage = '';
    userData.orderData = userData.orderData || {};

    switch (userData.sessionState) {
        case ORDER_TRACKING_STATES.AWAITING_AWB:
            userData.orderData.awb = incomingMsg;
            userData.sessionState = ORDER_TRACKING_STATES.AWAITING_COMPLAINT_DETAILS;
            responseMessage = `Got AWB: "${userData.orderData.awb}". What is your complaint or query about this order?`;
            break;
        case ORDER_TRACKING_STATES.AWAITING_COMPLAINT_DETAILS:
            const complaint = incomingMsg;
            const awb = userData.orderData.awb;

            // Placeholder: Simulate order tracking and complaint handling
            responseMessage = `Received your complaint about AWB "${awb}": "${complaint}".\n\n(Note: This feature requires integration with an order tracking API and a more sophisticated complaint resolution system, which are under development.)\n\nWe will get back to you shortly. Send another AWB or type 'main menu' to go back.`;
            // In a real scenario, you'd:
            // 1. Call an external API to track the AWB.
            // 2. Use Gemini to analyze the complaint and suggest next steps or draft a response.
            // 3. Potentially log the complaint in a CRM.
            userData.orderData = {}; // Clear for next query
            userData.sessionState = ORDER_TRACKING_STATES.AWAITING_AWB;
            break;
        default:
            responseMessage = `Welcome to the AI Order Tracking & Complaint Assistant! Please provide your Air Waybill (AWB) number to track your order or lodge a complaint.`;
            userData.sessionState = ORDER_TRACKING_STATES.AWAITING_AWB;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the Mental Health Journal & Therapy Companion.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleMentalHealthMessage(incomingMsg, userData) {
    let responseMessage = '';
    switch (userData.sessionState) {
        case MENTAL_HEALTH_STATES.AWAITING_FEELINGS:
            const userFeelings = incomingMsg;
            const prompt = `A user is journaling their feelings: "${userFeelings}". Reflect on their feelings, offer a calming thought, and suggest a journaling prompt for deeper reflection. Keep it supportive and concise.`;
            try {
                const result = await geminiModel.generateContent(prompt);
                const response = await result.response;
                responseMessage = `Thank you for sharing:\n\n${response.text().trim()}\n\nShare more about your day, or type 'main menu' to go back.`;
            } catch (error) {
                console.error('Error processing mental health entry with Gemini:', error);
                responseMessage = 'Sorry, I could not process your entry. Please try again.';
            }
            break;
        default:
            responseMessage = `Welcome to the Mental Health Journal & Therapy Companion. How was your day? What's on your mind?`;
            userData.sessionState = MENTAL_HEALTH_STATES.AWAITING_FEELINGS;
            break;
    }
    return responseMessage;
}

/**
 * Handles messages when the user is interacting with the Translator Bot.
 * This bot is kept separate from the main 12 for clarity in this large file.
 * @param {string} incomingMsg The incoming message from the user.
 * @param {object} userData The current user session data.
 * @returns {Promise<string>} The response message.
 */
async function handleTranslatorMessage(incomingMsg, userData) {
    let responseMessage = '';
    switch (userData.sessionState) {
        case TRANSLATOR_STATES.AWAITING_TEXT:
            // Store the text and ask for target language
            userData.textToTranslate = incomingMsg;
            userData.sessionState = TRANSLATOR_STATES.AWAITING_LANGUAGE;
            responseMessage = `You sent: "${incomingMsg}".\n\nWhich language do you want to translate it to? (e.g., *Spanish*, *French*, *Hindi*)`;
            break;
        case TRANSLATOR_STATES.AWAITING_LANGUAGE:
            const targetLanguage = incomingMsg;
            const text = userData.textToTranslate;

            if (!text) {
                responseMessage = `It seems I lost the text you wanted to translate. Please send the text again.`;
                userData.sessionState = TRANSLATOR_STATES.AWAITING_TEXT;
                break;
            }

            const prompt = `Translate the following text into ${targetLanguage}:\n\n"${text}"`;
            try {
                const result = await geminiModel.generateContent(prompt);
                const response = await result.response;
                responseMessage = `Here's the translation into ${targetLanguage}:\n\n"${response.text().trim()}"\n\nSend more text to translate, or type 'main menu' to go back.`;
                userData.sessionState = TRANSLATOR_STATES.AWAITING_TEXT; // Ready for next translation
            } catch (error) {
                console.error('Error translating text with Gemini:', error);
                responseMessage = 'Sorry, I could not translate that. Please try again or choose a different language.';
                userData.sessionState = TRANSLATOR_STATES.AWAITING_TEXT; // Stay in awaiting text
            }
            break;
        default:
            responseMessage = `Welcome to the Translator Bot! Please send me the text you want to translate.`;
            userData.sessionState = TRANSLATOR_STATES.AWAITING_TEXT;
            break;
    }
    return responseMessage;
}


/**
 * Main handler for incoming WhatsApp messages.
 * This function acts as the router for the BotHub.
 */
app.post('/whatsapp', async (req, res) => {
    const incomingMsg = req.body.Body.trim().toLowerCase();
    const from = req.body.From.replace('whatsapp:', ''); // User's WhatsApp number

    let userRef = db.collection('users').doc(from);
    let userDoc = await userRef.get();
    let userData = userDoc.exists ? userDoc.data() : {
        whatsappNumber: from,
        currentBot: null, // New field to track which sub-bot is active
        sessionState: USER_STATES.AWAITING_BOT_SELECTION, // Initial state for BotHub
        // Initialize all bot-specific data fields here, and clear them on "main menu"
        // Revision Bot data
        examType: null,
        subject: null,
        currentQuiz: { questionIds: [], currentQIndex: 0, score: 0, lastQuestionSent: null, lastAnswerCorrect: null },
        // Resume Generator Bot data
        resumeData: {},
        // Legal Simplifier Bot data
        legalData: {},
        // News Digest Bot data
        newsPreferences: null,
        deliveryTime: null,
        // Recipe Coach Bot data
        // No specific data to initialize here beyond session state
        // Career Counselor Bot data
        careerData: {},
        // YouTube Script Bot data
        // No specific data to initialize here beyond session state
        // Local Services Bot data
        // No specific data to initialize here beyond session state
        // Finance Reminder Bot data
        financeData: {},
        // Instagram Caption Bot data
        // No specific data to initialize here beyond session state
        // Order Tracking Bot data
        orderData: {},
        // Mental Health Bot data
        // No specific data to initialize here beyond session state
        // Translator Bot data
        textToTranslate: null,

        lastInteraction: admin.firestore.FieldValue.serverTimestamp()
    };

    let responseMessage = '';

    try {
        // --- Global Commands ---
        if (incomingMsg === 'restart' || incomingMsg === 'main menu') {
            // Reset to main bot selection menu
            userData.currentBot = null;
            userData.sessionState = USER_STATES.AWAITING_BOT_SELECTION;
            // Clear all bot-specific states/data
            userData.examType = null;
            userData.subject = null;
            userData.currentQuiz = { questionIds: [], currentQIndex: 0, score: 0, lastQuestionSent: null, lastAnswerCorrect: null };
            userData.resumeData = {};
            userData.legalData = {};
            userData.newsPreferences = null;
            userData.deliveryTime = null;
            userData.careerData = {};
            userData.financeData = {};
            userData.orderData = {};
            userData.textToTranslate = null;
            // Add clearing for any other bot-specific data here as you implement them

            const botOptions = Object.keys(MAIN_MENU_OPTIONS).map(key => `${key}️⃣ ${MAIN_MENU_OPTIONS[key].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`).join('\n');
            responseMessage = `👋 Welcome to the BotHub! Please choose a bot to interact with:\n${botOptions}\n\nType *main menu* at any time to return here.`;
            await userRef.set(userData); // Save state immediately
            sendWhatsAppMessage(from, responseMessage);
            res.status(200).send('Message processed');
            return; // Exit early after handling global command
        }

        // --- Bot Hub Routing Logic ---
        if (userData.sessionState === USER_STATES.AWAITING_BOT_SELECTION) {
            const selectedBot = MAIN_MENU_OPTIONS[incomingMsg];
            if (selectedBot) {
                userData.currentBot = selectedBot;
                // Set initial state and welcome message for the selected bot
                switch (selectedBot) {
                    case BOT_TYPES.REVISION_BOT:
                        userData.sessionState = REVISION_BOT_STATES.AWAITING_EXAM_SELECTION;
                        const examOptions = Object.keys(EXAMS).map(key => `${key}️⃣ ${EXAMS[key]}`).join('\n');
                        responseMessage = `Welcome to the Exam Revision Bot! Which exam are you preparing for?\n${examOptions}`;
                        break;
                    case BOT_TYPES.RESUME_GENERATOR_BOT:
                        userData.sessionState = RESUME_GENERATOR_STATES.AWAITING_NAME;
                        responseMessage = `Welcome to the Resume & Cover Letter Generator Bot! What is your full name?`;
                        break;
                    case BOT_TYPES.LEGAL_SIMPLIFIER_BOT:
                        userData.sessionState = LEGAL_SIMPLIFIER_STATES.AWAITING_DOCUMENT_TEXT;
                        responseMessage = `Welcome to the Legal Document Simplifier Bot! Please paste the legal document or text you want me to explain.`;
                        break;
                    case BOT_TYPES.NEWS_DIGEST_BOT:
                        userData.sessionState = NEWS_DIGEST_STATES.AWAITING_FEED_PREFERENCE;
                        responseMessage = `Welcome to the Daily News Digest Bot! What kind of news are you interested in? (e.g., *Politics*, *Tech*, *Cricket*, *Finance*)`;
                        break;
                    case BOT_TYPES.RECIPE_COACH_BOT:
                        userData.sessionState = RECIPE_COACH_STATES.AWAITING_INGREDIENTS;
                        responseMessage = `Welcome to the WhatsApp Recipe Coach Bot! Tell me what ingredients you have (e.g., "potato, onion, turmeric") or send a food photo.`;
                        break;
                    case BOT_TYPES.CAREER_COUNSELOR_BOT:
                        userData.sessionState = CAREER_COUNSELOR_STATES.AWAITING_INTERESTS;
                        responseMessage = `Welcome to the AI Career Counselor Bot! Tell me about your interests (e.g., "coding, writing, helping people").`;
                        break;
                    case BOT_TYPES.YOUTUBE_SCRIPT_BOT:
                        userData.sessionState = YOUTUBE_SCRIPT_STATES.AWAITING_VIDEO_IDEA;
                        responseMessage = `Welcome to the YouTube Script & Thumbnail Bot! What's your video idea?`;
                        break;
                    case BOT_TYPES.LOCAL_SERVICES_BOT:
                        userData.sessionState = LOCAL_SERVICES_STATES.AWAITING_CITY_SERVICE;
                        responseMessage = `Welcome to the Local Services Finder Bot! Tell me what service you need and in which city (e.g., "Plumber in Delhi", "Electrician in Mumbai").`;
                        break;
                    case BOT_TYPES.FINANCE_REMINDER_BOT:
                        userData.sessionState = FINANCE_REMINDER_STATES.MAIN_MENU; // Or AWAITING_BILL_TYPE if you want to jump straight
                        responseMessage = `Welcome to the Personal Finance & Bill Reminder Bot! Type *add bill* to set a reminder or *tips* for financial advice.`;
                        break;
                    case BOT_TYPES.INSTAGRAM_CAPTION_BOT:
                        userData.sessionState = INSTAGRAM_CAPTION_STATES.AWAITING_PHOTO_DESCRIPTION;
                        responseMessage = `Welcome to the Instagram Caption/Hashtag Generator Bot! Describe your photo or content (e.g., "sunset at beach", "new product launch").`;
                        break;
                    case BOT_TYPES.ORDER_TRACKING_BOT:
                        userData.sessionState = ORDER_TRACKING_STATES.AWAITING_AWB;
                        responseMessage = `Welcome to the AI Order Tracking & Complaint Assistant! Please provide your Air Waybill (AWB) number to track your order or lodge a complaint.`;
                        break;
                    case BOT_TYPES.MENTAL_HEALTH_BOT:
                        userData.sessionState = MENTAL_HEALTH_STATES.AWAITING_FEELINGS;
                        responseMessage = `Welcome to the Mental Health Journal & Therapy Companion. How was your day? What's on your mind?`;
                        break;
                    case BOT_TYPES.TRANSLATOR_BOT: // Translator bot is still here but not in MAIN_MENU_OPTIONS
                        userData.sessionState = TRANSLATOR_STATES.AWAITING_TEXT;
                        responseMessage = `Welcome to the Translator Bot! Please send me the text you want to translate.`;
                        break;
                    default:
                        responseMessage = `Invalid bot selection. Please choose a number from the list.`;
                        break;
                }
            } else {
                const botOptions = Object.keys(MAIN_MENU_OPTIONS).map(key => `${key}️⃣ ${MAIN_MENU_OPTIONS[key].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`).join('\n');
                responseMessage = `Invalid selection. Please choose a bot to interact with:\n${botOptions}`;
            }
        } else {
            // User is already in a sub-bot, delegate the message
            switch (userData.currentBot) {
                case BOT_TYPES.REVISION_BOT:
                    responseMessage = await handleRevisionBotMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.RESUME_GENERATOR_BOT:
                    responseMessage = await handleResumeBotMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.LEGAL_SIMPLIFIER_BOT:
                    responseMessage = await handleLegalSimplifierMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.NEWS_DIGEST_BOT:
                    responseMessage = await handleNewsDigestMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.RECIPE_COACH_BOT:
                    responseMessage = await handleRecipeCoachMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.CAREER_COUNSELOR_BOT:
                    responseMessage = await handleCareerCounselorMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.YOUTUBE_SCRIPT_BOT:
                    responseMessage = await handleYoutubeScriptBotMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.LOCAL_SERVICES_BOT:
                    responseMessage = await handleLocalServicesMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.FINANCE_REMINDER_BOT:
                    responseMessage = await handleFinanceReminderMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.INSTAGRAM_CAPTION_BOT:
                    responseMessage = await handleInstagramCaptionMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.ORDER_TRACKING_BOT:
                    responseMessage = await handleOrderTrackingMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.MENTAL_HEALTH_BOT:
                    responseMessage = await handleMentalHealthMessage(incomingMsg, userData);
                    break;
                case BOT_TYPES.TRANSLATOR_BOT:
                    responseMessage = await handleTranslatorMessage(incomingMsg, userData);
                    break;
                default:
                    // Fallback if currentBot is somehow invalid
                    userData.currentBot = null;
                    userData.sessionState = USER_STATES.AWAITING_BOT_SELECTION;
                    const botOptions = Object.keys(MAIN_MENU_OPTIONS).map(key => `${key}️⃣ ${MAIN_MENU_OPTIONS[key].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`).join('\n');
                    responseMessage = `An unexpected error occurred. Returning to main menu. Please choose a bot:\n${botOptions}`;
                    break;
            }
        }
    } catch (error) {
        console.error('Error handling message in main router:', error);
        responseMessage = 'Oops! Something went wrong. Please try again later. Type *main menu* to restart.';
        // On critical error, reset to main menu
        userData.currentBot = null;
        userData.sessionState = USER_STATES.AWAITING_BOT_SELECTION;
    } finally {
        // Always update user data in Firestore
        userData.lastInteraction = admin.firestore.FieldValue.serverTimestamp();
        await userRef.set(userData);
        sendWhatsAppMessage(from, responseMessage);
        res.status(200).send('Message processed'); // Acknowledge Twilio webhook
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Twilio webhook URL: YOUR_NGROK_URL/whatsapp`);
});
