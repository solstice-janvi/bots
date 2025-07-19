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

// User session states
const USER_STATES = {
    AWAITING_EXAM_SELECTION: 'awaiting_exam_selection',
    AWAITING_SUBJECT_SELECTION: 'awaiting_subject_selection',
    MAIN_MENU: 'main_menu',
    IN_QUIZ: 'in_quiz',
    AWAITING_QUIZ_ANSWER: 'awaiting_quiz_answer',
    AWAITING_FLASHCARD_TOPIC: 'awaiting_flashcard_topic',
    AWAITING_AI_QUIZ_TOPIC: 'awaiting_ai_quiz_topic' // New state for AI quiz topic
};

// Available exams and subjects (can be dynamic from Firestore later)
// These are hardcoded for simplicity but could be fetched from Firestore.
const EXAMS = {
    '1': 'JEE',
    '2': 'NEET',
    '3': 'UPSC',
    '4': 'CUET',
    '5': 'SSC CGL',
    '6': 'School Exams (Class 10)', // New Exam Category
    '7': 'School Exams (Class 12)', // New Exam Category
    '8': 'Bank PO/Clerk' // New Exam Category
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
    'School Exams (Class 10)': { // Subjects for Class 10
        '1': 'Mathematics',
        '2': 'Science',
        '3': 'Social Science',
        '4': 'English Language & Literature',
        '5': 'Hindi'
    },
    'School Exams (Class 12)': { // Subjects for Class 12
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
    'Bank PO/Clerk': { // Subjects for Bank Exams
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
        // Use Gemini to generate content
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
        // Use Gemini to generate content
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


/**
 * Handles incoming WhatsApp messages.
 * This is the main webhook endpoint for Twilio.
 */
app.post('/whatsapp', async (req, res) => {
    const incomingMsg = req.body.Body.trim().toLowerCase();
    const from = req.body.From.replace('whatsapp:', ''); // User's WhatsApp number

    let userRef = db.collection('users').doc(from);
    let userDoc = await userRef.get();
    let userData = userDoc.exists ? userDoc.data() : {
        whatsappNumber: from,
        examType: null,
        subject: null,
        sessionState: USER_STATES.AWAITING_EXAM_SELECTION,
        currentQuiz: {
            questionIds: [], // Stores { id, data } for Firebase, or just { data } for AI
            currentQIndex: 0,
            score: 0,
            lastQuestionSent: null, // Stores the full question object
            lastAnswerCorrect: null
        },
        lastInteraction: admin.firestore.FieldValue.serverTimestamp()
    };

    let responseMessage = '';

    try {
        switch (userData.sessionState) {
            case USER_STATES.AWAITING_EXAM_SELECTION:
                if (EXAMS[incomingMsg]) {
                    userData.examType = EXAMS[incomingMsg];
                    userData.sessionState = USER_STATES.AWAITING_SUBJECT_SELECTION;
                    const subjectOptions = Object.keys(SUBJECTS[userData.examType]).map(key => `${key}️⃣ ${SUBJECTS[userData.examType][key]}`).join('\n');
                    responseMessage = `➡️ You selected ${userData.examType}!\nWhich subject?\n${subjectOptions}`;
                } else {
                    const examOptions = Object.keys(EXAMS).map(key => `${key}️⃣ ${EXAMS[key]}`).join('\n');
                    responseMessage = `👋 Hi! Welcome to ExamCoachBot. Which exam are you preparing for?\n${examOptions}\nPlease choose a number from the list.`;
                }
                break;

            case USER_STATES.AWAITING_SUBJECT_SELECTION:
                if (userData.examType && SUBJECTS[userData.examType] && SUBJECTS[userData.examType][incomingMsg]) {
                    userData.subject = SUBJECTS[userData.examType][incomingMsg];
                    userData.sessionState = USER_STATES.MAIN_MENU;
                    responseMessage = `➡️ You selected ${userData.subject}.\nWant a *quiz* (from curated questions), *ai quiz* (generated by AI), or *flashcards* today?\n👉 Type: *quiz*, *ai quiz*, or *flashcards*`;
                } else {
                    const subjectOptions = Object.keys(SUBJECTS[userData.examType]).map(key => `${key}️⃣ ${SUBJECTS[userData.examType][key]}`).join('\n');
                    responseMessage = `Please select a valid subject for ${userData.examType}:\n${subjectOptions}`;
                }
                break;

            case USER_STATES.MAIN_MENU:
                if (incomingMsg === 'quiz') {
                    // Fetch 3-5 MCQs for the selected subject from Firestore
                    const mcqsSnapshot = await db.collection('mcqs')
                        .where('examType', '==', userData.examType)
                        .where('subject', '==', userData.subject)
                        .limit(3) // Get 3 questions for a short quiz
                        .get();

                    if (mcqsSnapshot.empty) {
                        responseMessage = `Sorry, no curated quiz questions found for ${userData.subject}. Please try another subject or check back later, or try an *ai quiz*.`;
                        userData.sessionState = USER_STATES.MAIN_MENU; // Stay in main menu
                    } else {
                        userData.currentQuiz.questionIds = mcqsSnapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
                        userData.currentQuiz.currentQIndex = 0;
                        userData.currentQuiz.score = 0;
                        userData.sessionState = USER_STATES.IN_QUIZ;

                        // Send the first question
                        const firstQuestion = userData.currentQuiz.questionIds[0].data;
                        userData.currentQuiz.lastQuestionSent = firstQuestion; // Store the question object
                        responseMessage = `🔹 Quiz Q${userData.currentQuiz.currentQIndex + 1}: ${firstQuestion.question}\n${firstQuestion.options.map((opt, i) => `${String.fromCharCode(97 + i)}) ${opt}`).join('\n')}`;
                        userData.sessionState = USER_STATES.AWAITING_QUIZ_ANSWER;
                    }
                } else if (incomingMsg === 'ai quiz') {
                    userData.sessionState = USER_STATES.AWAITING_AI_QUIZ_TOPIC;
                    responseMessage = `Great! For your AI-generated quiz, which specific topic in ${userData.subject} would you like questions on? (e.g., Thermodynamics, Indian History, etc.)`;
                }
                else if (incomingMsg === 'flashcards') {
                    userData.sessionState = USER_STATES.AWAITING_FLASHCARD_TOPIC;
                    responseMessage = `Great! Which specific topic in ${userData.subject} would you like flashcards or a summary for? (e.g., Thermodynamics, Optics, etc.)`;
                } else if (incomingMsg === 'change exam' || incomingMsg === 'change subject' || incomingMsg === 'restart') { // Added 'restart'
                    userData.examType = null;
                    userData.subject = null;
                    userData.sessionState = USER_STATES.AWAITING_EXAM_SELECTION;
                    const examOptions = Object.keys(EXAMS).map(key => `${key}️⃣ ${EXAMS[key]}`).join('\n');
                    responseMessage = `Okay, let's start over. Which exam are you preparing for?\n${examOptions}`;
                } else {
                    responseMessage = `I didn't understand that. Please type *quiz*, *ai quiz*, *flashcards*, *change exam*, *change subject*, or *restart*.`; // Updated prompt
                }
                break;

            case USER_STATES.AWAITING_AI_QUIZ_TOPIC:
                const aiQuizTopic = incomingMsg;
                const aiQuestions = await generateAIQuiz(userData.examType, userData.subject, aiQuizTopic);

                if (aiQuestions.length > 0) {
                    userData.currentQuiz.questionIds = aiQuestions.map(q => ({ data: q })); // AI questions don't have Firestore IDs
                    userData.currentQuiz.currentQIndex = 0;
                    userData.currentQuiz.score = 0;
                    userData.sessionState = USER_STATES.IN_QUIZ;

                    const firstAIQuestion = userData.currentQuiz.questionIds[0].data;
                    userData.currentQuiz.lastQuestionSent = firstAIQuestion;
                    responseMessage = `🧠 Here's your AI-generated quiz on "${aiQuizTopic}"!\n\n🔹 Quiz Q${userData.currentQuiz.currentQIndex + 1}: ${firstAIQuestion.question}\n${firstAIQuestion.options.map((opt, i) => `${String.fromCharCode(97 + i)}) ${opt}`).join('\n')}`;
                    userData.sessionState = USER_STATES.AWAITING_QUIZ_ANSWER;
                } else {
                    responseMessage = `Sorry, I couldn't generate an AI quiz for "${aiQuizTopic}". Please try a different topic or try again later.`;
                    userData.sessionState = USER_STATES.MAIN_MENU; // Go back to main menu
                }
                break;

            case USER_STATES.AWAITING_QUIZ_ANSWER:
                const currentQuestionData = userData.currentQuiz.lastQuestionSent;
                if (!currentQuestionData) {
                    responseMessage = "It seems there was an issue with the last question. Let's try starting a new quiz. Type *quiz* or *ai quiz* to begin.";
                    userData.sessionState = USER_STATES.MAIN_MENU;
                    break;
                }

                const userAnswerIndex = incomingMsg.charCodeAt(0) - 97; // 'a' -> 0, 'b' -> 1, etc.
                const isCorrect = (userAnswerIndex === currentQuestionData.correctAnswerIndex);

                let explanation = await generateExplanation(
                    currentQuestionData.question,
                    currentQuestionData.options,
                    currentQuestionData.correctAnswerIndex,
                    currentQuestionData.options[userAnswerIndex] || incomingMsg // Use option text if valid, else user's raw input
                );

                if (isCorrect) {
                    userData.currentQuiz.score++;
                    responseMessage = `✅ Correct! ${explanation}`;
                } else {
                    responseMessage = `❌ Incorrect. ${explanation}`;
                }

                userData.currentQuiz.currentQIndex++;

                if (userData.currentQuiz.currentQIndex < userData.currentQuiz.questionIds.length) {
                    // Send next question
                    const nextQuestion = userData.currentQuiz.questionIds[userData.currentQuiz.currentQIndex].data;
                    userData.currentQuiz.lastQuestionSent = nextQuestion; // Store the next question object
                    responseMessage += `\n\n🔹 Quiz Q${userData.currentQuiz.currentQIndex + 1}: ${nextQuestion.question}\n${nextQuestion.options.map((opt, i) => `${String.fromCharCode(97 + i)}) ${opt}`).join('\n')}`;
                    userData.sessionState = USER_STATES.AWAITING_QUIZ_ANSWER; // Stay in this state
                } else {
                    // Quiz finished
                    responseMessage += `\n\n🎉 Quiz finished! You scored ${userData.currentQuiz.score} out of ${userData.currentQuiz.questionIds.length}.\n\nWhat next? Type *quiz* for another curated quiz, *ai quiz* for a generated one, *flashcards* for revision, *change exam* / *change subject*, or *restart*.`; // Updated prompt
                    userData.sessionState = USER_STATES.MAIN_MENU;
                    userData.currentQuiz = { // Reset quiz state
                        questionIds: [],
                        currentQIndex: 0,
                        score: 0,
                        lastQuestionSent: null,
                        lastAnswerCorrect: null
                    };
                }
                break;

            case USER_STATES.AWAITING_FLASHCARD_TOPIC:
                const topic = incomingMsg;
                // Determine if user wants flashcards or summary (default to flashcards if not specified)
                let contentType = 'flashcards';
                if (topic.includes('summary')) {
                    contentType = 'summary';
                }

                const revisionContent = await generateRevisionContent(topic, contentType);
                responseMessage = `Here's your ${contentType} for "${topic}":\n\n${revisionContent}\n\nWhat next? Type *quiz* for a quiz, *ai quiz* for a generated one, *flashcards* for more revision, or *change exam* / *change subject*, or *restart*.`; // Updated prompt
                userData.sessionState = USER_STATES.MAIN_MENU;
                break;

            default:
                // Fallback for unknown states or initial contact
                const examOptions = Object.keys(EXAMS).map(key => `${key}️⃣ ${EXAMS[key]}`).join('\n');
                responseMessage = `👋 Hi! Welcome to ExamCoachBot. Which exam are you preparing for?\n${examOptions}\n\nTo restart at any time, type *restart*.`; // Updated initial prompt
                userData.sessionState = USER_STATES.AWAITING_EXAM_SELECTION;
                break;
        }
    } catch (error) {
        console.error('Error handling message:', error);
        responseMessage = 'Oops! Something went wrong. Please try again later. If the issue persists, you can type *restart* to reset.'; // Updated error prompt
        // Optionally reset state on error to prevent being stuck
        userData.sessionState = USER_STATES.MAIN_MENU;
    } finally {
        // Always update user data in Firestore
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
