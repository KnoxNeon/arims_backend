import dotenv from "dotenv";
dotenv.config();
import bcrypt from "bcryptjs";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import crypto from "crypto";
import bodyParser from "body-parser";
import multer from "multer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import Groq from "groq-sdk";

// Multer Setup (file upload)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed."));
    }
  },
});


// GROQ Setup
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const app = express();
const port = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5000",
  "https://your-vercel-url.vercel.app", // add this after deploying to Vercel
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.FRONTEND_URL,
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.p0naaxz.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;

async function connectDB() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    db = client.db(process.env.DB_NAME);
    console.log("✅ Connected to MongoDB Atlas");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}

// Routes
app.get("/", (req, res) => {
  res.send("Hello from ARIMS backend");
});

app.get("/api/test", (req, res) => {
  res.status(200).json({ status: "🚀 Server is running" });
});

// start session
app.post("/api/interview/ai/session/start", async (req, res) => {
  try {
    const { field, sector, role, difficulty, focusTopics, totalQuestions } = req.body;
    const session = {
      config: {
        sector,
        role,
        difficulty,
        focusTopics,
        totalQuestions,
      },
      questions: null,
      answers: [],
      currentQuestionIndex: -1,
      timeRemainingForCurrentQuestion:3,
      overallScore: 0,
      analytics: null,
      createdAt: new Date(),
      endedAt: null,
      completed: false,
    };

    const prompt = `
  Your are a professional technical einterviewer.
  Generate ${totalQuestions} unique technical interview question (concisely/to the point/2marks) for a candidate:
  Sector: ${sector}
  Role: ${role}
  Difficulty: ${difficulty}
  Focus Topics: ${focusTopics.join ? focusTopics.join(", ") : focusTopics}

  Rules: 
  - Questions must be unique
  - Avoid repeating topics
  - Ask realistic industry interview questions

  return json array format
  [
  {
      "questionText": "...",
      "topic": "...",
  }
  {
      "questionText": "...",
      "topic": "...",
  }
]
  Doesn't add any other text before or after array, just give the json array directly even without .
  `;

    let aiResult;

    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile", //free and very capable
        messages: [
          { role: "system", content: "You are a strict technical interviewer." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      });

      aiResult = completion.choices[0].message.content;
    } catch (err) {
      console.error("AI Error:", err);
      return res.status(500).json({ error: "AI evaluation failed" });
    }

    // Parse AI JSON safely
    let parsedQuestions;
    console.log("ai result: ", aiResult);

    console.log(aiResult);
    try {
      parsedQuestions = JSON.parse(aiResult);
    } catch (e) {
      console.log("error parsing:", e.message);
      return res.status(500).json({ error: "Invalid AI response format", raw: aiResult });
    }

    session.questions = parsedQuestions;

    const result = await db.collection("aiSessions").insertOne(session);
    res.json({ sessionId: result.insertedId });
  } catch (err) {
    console.error("AI Interview Start Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

//  Get Session by ID
app.get("/api/interview/ai/session/:sessionId", async (req, res) => {
  try {
    const session = await db.collection("aiSessions").findOne({ _id: new ObjectId(req.params.sessionId) });

    if (!session) return res.status(404).json({ error: "Session not found" });
    console.log("session: ", session);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: "Invalid session ID" });
  }
});
app.patch("/api/interview/ai/session/:sessionId", async (req, res) => {
  const {currentQuestionIndex}=req.body
  const update = {
    $set:{
      currentQuestionIndex
    }
  }
  const result = await db.collection("aiSessions").updateOne({ _id: new ObjectId(req.params.sessionId)},update)
 console.log("update: ",result);
  res.json({questionIndex:currentQuestionIndex})
});

// making question
app.post("/api/interview/ai/question", async (req, res) => {
  console.log(req.body);
  const { role, sessionId, sector, difficulty, focusTopics, totalQuestions } = req.body;

  const prompt = `
  Your are a professional technical einterviewer.
  Generate ${totalQuestions} unique technical interview question (concisely/to the point/2marks) for a candidate:
  Sector: ${sector}
  Role: ${role}
  Difficulty: ${difficulty}
  Focus Topics: ${focusTopics.join ? focusTopics.join(", ") : focusTopics}

  Rules: 
  - Questions must be unique
  - Avoid repeating topics
  - Ask realistic industry interview questions

  return json array format
  [
  {
      "questionText": "...",
      "topic": "...",
  }
  {
      "questionText": "...",
      "topic": "...",
  }
]
  Doesn't add any other text before or after array, just give the json array directly even without .
  `;

  let aiResult;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile", //free and very capable
      messages: [
        { role: "system", content: "You are a strict technical interviewer." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });

    aiResult = completion.choices[0].message.content;
  } catch (err) {
    console.error("AI Error:", err);
    return res.status(500).json({ error: "AI evaluation failed" });
  }

  // Parse AI JSON safely
  let parsed;
  console.log("ai result: ", aiResult);

  console.log(aiResult);
  try {
    parsed = JSON.parse(aiResult);
  } catch (e) {
    console.log("error parsing:", e.message);
    return res.status(500).json({ error: "Invalid AI response format", raw: aiResult });
  }
  console.log("parsed: ", parsed);
  const currentSession = await db.collection("aiSessions").findOne({ _id: new ObjectId(sessionId) });
  currentSession.questions = parsed;
  currentSession.status = true;
  const update = {
    $set: {
      ...currentSession,
    },
  };
  const result = await db.collection("aiSessions").updateOne({ _id: new ObjectId(sessionId) }, update);

  res.json({
    sessionId,
    questions: parsed,
    timePerQuestion: 150,
  });
});
// NEXT QUESTION / SUBMIT ANSWER / Evaluation
app.post("/api/interview/ai/answer", async (req, res) => {
  try {
    const { sessionId, answer } = req.body;
    const interview = await db.collection("aiSessions").findOne({ _id: new ObjectId(sessionId) });
    if (!interview || interview.completed) return res.status(400).json({ error: "Invalid session" });

    const question = interview.questions[interview.currentQuestionIndex];
    console.log(question.questionText, answer);
    const now = Date.now();
    const timeSpent = (now - interview.questionStartedAt) / 1000;

    if (timeSpent > interview.timePerQuestion) {
      return res.json({
        timeout: true,
        message: "Time exceeded for this question.",
      });
    }

    // AI Evaluation (Q-by-Q)
    let lastEvaluation = null;
    if (answer) {
      try {
        const prompt = `
        You are a strict technical interviewer.
        Evaluate the candidate answer based on:

        Topic: ${question.topic}
        Question: ${question.questionText}
        Answer: ${answer}

        Provide JSON with keys:
        technical (0-10), clarity (0-10), depth (0-10), feedback, idealAnswer, improvementTips
        `;

        const completion = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile", //free and very capable
          messages: [
            { role: "system", content: "You are a strict technical interviewer. Return ONLY valid JSON." },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
        });

        let evalContent = completion.choices[0].message.content.trim();
        // Clean up markdown if present
        if (evalContent.startsWith("```json")) {
          evalContent = evalContent.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        } else if (evalContent.startsWith("```")) {
          evalContent = evalContent.replace(/^```\s*/, "").replace(/\s*```$/, "");
        }
        lastEvaluation = JSON.parse(evalContent);

        const scoreSum = lastEvaluation.technical + lastEvaluation.clarity + lastEvaluation.depth;
        interview.answers.push({
          question: question.questionText,
          answer,
          evaluation: lastEvaluation,
          score: scoreSum,
        });
        interview.overallScore += scoreSum;
      } catch (err) {
        console.error("AI eval error:", err);
        // Continue without evaluation if AI fails
        interview.answers.push({
          question: question.questionText,
          answer,
          evaluation: {
            technical: 5,
            clarity: 5,
            depth: 5,
            feedback: "Evaluation failed",
            idealAnswer: "",
            improvementTips: "",
          },
          score: 15,
        });
        interview.overallScore += 15;
      }
    }
    interview.currentQuestionIndex++;

    // Check round completion

    // Check session completion
    if (interview.currentQuestionIndex >= interview.config.totalQuestions) {
      interview.completed = true;
      interview.status = "End";
      interview.endedAt = new Date();

      // Final Analytics intervie round object-r answer
      const allAnswers = interview.answers;
      console.log("allAnswers: ", allAnswers);
      const avgTechnical = allAnswers.reduce((sum, a) => sum + a.evaluation.technical, 0) / allAnswers.length;
      const avgClarity = allAnswers.reduce((sum, a) => sum + a.evaluation.clarity, 0) / allAnswers.length;
      const avgDepth = allAnswers.reduce((sum, a) => sum + a.evaluation.depth, 0) / allAnswers.length;

      const strengths = [];
      const weaknesses = [];
      if (avgTechnical >= 7) strengths.push("Technical Knowledge");
      else if (avgTechnical < 5) weaknesses.push("Technical Knowledge");
      if (avgClarity >= 7) strengths.push("Communication Clarity");
      else if (avgClarity < 5) weaknesses.push("Communication Clarity");
      if (avgDepth >= 7) strengths.push("Conceptual Depth");
      else if (avgDepth < 5) weaknesses.push("Conceptual Depth");

      let level = "Beginner";
      const overallAvg = (avgTechnical + avgClarity + avgDepth) / 3;
      if (overallAvg >= 8) level = "Advanced";
      else if (overallAvg >= 6) level = "Intermediate";

      // AI Recommendation
      let recommendation = "Keep improving.";
      try {
        const prompt2 = `
        Topic: ${question.topic}
        Question: ${question.questionText}
        Answer: ${answer}
        Based on the following performance metrics:
        Technical: ${avgTechnical.toFixed(1)}
        Clarity: ${avgClarity.toFixed(1)}
        Depth: ${avgDepth.toFixed(1)}
        Overall Level: ${level}
        Provide a short and concise professional career recommendation.
        `;
        const completion2 = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile", //free and very capable
          messages: [
            { role: "system", content: "You are a senior career advisor." },
            { role: "user", content: prompt2 },
          ],
          temperature: 0.5,
        });
        recommendation = completion2.choices[0].message.content;
      } catch (err) {
        console.error("Recommendation error", err);
      }

      // here can added the analytics to db , that is optional
      interview.analytics = {
        avgTechnical: avgTechnical.toFixed(1),
        avgClarity: avgClarity.toFixed(1),
        avgDepth: avgDepth.toFixed(1),
        strengths,
        weaknesses,
        level,
        recommendation,
      };

      const update = {
        $set: {
          ...interview,
        },
      };
      const result = await db.collection("aiSessions").updateOne({ _id: new ObjectId(sessionId) }, update);

      return res.json({
        completed: true,
        totalScore: interview.overallScore,
        analytics: interview.analytics,
      });
    }

    const update = {
      $set: {
        ...interview,
      },
    };
    const result = await db.collection("aiSessions").updateOne({ _id: new ObjectId(sessionId) }, update);

    res.json({
      completed: false,
      evaluation: lastEvaluation,
      question: question.questionText,
      answer: answer,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed next question" });
  }
});

/**
 * AI Explanation / Feedback Endpoint
 * Accepts: questionTopic, questionText, correctAnswer, userAnswer
 * Responds with: aiExplanation
 */
app.post("/api/ai/explain", async (req, res) => {
  try {
    const { questionTopic, questionText, correctAnswer, userAnswer } = req.body;

    if (!questionTopic || !questionText || !correctAnswer || !userAnswer) {
      return res.status(400).json({ error: "Invalid input" });
    }
    console.log(req.body);

    // Prompt template
    const prompt = `
You are an expert interview assistant.

Question: "${questionText}"
Topic: "${questionTopic}"
Correct answer: "${correctAnswer}"
User Answer: "${userAnswer}"

Explain briefly why the correct answer is correct and why the user is right or wrong.
Respond ONLY in JSON format:
{
 "correct": boolean,
 "explanation": string
}

Do not include any other text.
---`;

    // Call Groq
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile", //free and very capable
      messages: [
        { role: "system", content: "You provide structured feedback for MCQ interview responses." },
        { role: "user", content: prompt },
      ],
      max_tokens: 200,
      temperature: 0.45,
    });

    const text = completion.choices[0].message.content.trim();

    // Try parse JSON
    let aiResult;
    try {
      aiResult = JSON.parse(text);
    } catch (err) {
      return res.status(500).json({ error: "AI result parsing failed", raw: text });
    }

    // Return actual output
    return res.json({
      aiExplanation: aiResult.explanation,
      correct: aiResult.correct,
    });
  } catch (err) {
    console.error("AI Explain Error:", err);
    return res.status(500).json({ error: "AI failed" });
  }
});

// Helper: Question Validation
function validateQuestion(data) {
  console.log(data);
  if (!data.role) return "Role is required";
  // if (!data.industry) return "Industry is required";
  if (!data.difficulty) return "Difficulty is required";
  if (!data.topic) return "Topic is required";
  if (!data.questionType) return "Question type is required";
  if (!data.questionText) return "Question text is required";
  if (!data.marks || typeof data.marks !== "number") return "Marks must be a number";

  if (data.questionType === "MCQ") {
    if (!Array.isArray(data.options) || data.options.length < 2) return "MCQ must have at least 2 options";

    if (!data.options.includes(data.correctAnswer)) return "Correct answer must match one of the options";
  }

  return null;
}

//   Create Question
app.post("/api/admin/questions", async (req, res) => {
  try {
    const error = validateQuestion(req.body);
    if (error) return res.status(400).json({ error });

    const question = {
      role: req.body.role,
      difficulty: req.body.difficulty,
      topic: req.body.topic,
      questionType: req.body.questionType,
      questionText: req.body.questionText,
      options: req.body.options || [],
      correctAnswer: req.body.correctAnswer || null,
      marks: req.body.marks,
      explanation: req.body.explanation || "",
      tags: req.body.tags || [],
      status: req.body.status || "active",
      createdAt: new Date(),
      isDeleted: false,
    };
    console.log(question);
    const result = await db.collection("questions").insertOne(question);

    res.json({
      message: "Question created successfully",
      insertedId: result.insertedId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

//   Get All Questions (Filter + Search)
app.get("/api/admin/questions", async (req, res) => {
  try {
    const filter = { isDeleted: false };

    if (req.query.role) filter.role = req.query.role;
    if (req.query.industry) filter.industry = req.query.industry;
    if (req.query.difficulty) filter.difficulty = req.query.difficulty;
    if (req.query.topic) filter.topic = req.query.topic;
    if (req.query.status) filter.status = req.query.status;

    if (req.query.search) {
      filter.questionText = {
        $regex: req.query.search,
        $options: "i",
      };
    }

    const questions = await db.collection("questions").find(filter).sort({ createdAt: -1 }).toArray();

    res.json(questions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

//  Get Single Question
app.get("/api/admin/questions/:id", async (req, res) => {
  try {
    const question = await db.collection("questions").findOne({
      _id: new ObjectId(req.params.id),
      isDeleted: false,
    });

    if (!question) return res.status(404).json({ error: "Question not found" });

    res.json(question);
  } catch (err) {
    res.status(500).json({ error: "Invalid ID" });
  }
});

//  Update Question
app.put("/api/admin/questions/:id", async (req, res) => {
  try {
    const error = validateQuestion(req.body);
    if (error) return res.status(400).json({ error });

    const updatedData = {
      $set: {
          role: req.body.role,
          industry: req.body.industry,
          difficulty: req.body.difficulty,
          topic: req.body.topic,
          questionType: req.body.questionType,
          questionText: req.body.questionText,
          options: req.body.options || [],
          correctAnswer: req.body.correctAnswer || null,
          marks: req.body.marks,
          explanation: req.body.explanation || "",
          tags: req.body.tags || [],
          status: req.body.status || "active",
          updatedAt: new Date(),
        },
    };

    const result = await db.collection("questions").updateOne(
      { _id: new ObjectId(req.params.id) },updatedData,
    );

    res.json({ message: "Question updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Server Error" });
  }
});

//  Soft Delete Question
app.delete("/api/admin/questions/:id", async (req, res) => {
  try {
    await db.collection("questions").updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          isDeleted: true,
          updatedAt: new Date(),
        },
      },
    );

    res.json({ message: "Question soft deleted" });
  } catch (err) {
    res.status(500).json({ error: "Server Error" });
  }
});

//  Bulk Insert Questions
app.post("/api/admin/questions/bulk", async (req, res) => {
  try {
    const questions = req.body;

    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: "Array required" });
    }

    const collection = db.collection("questions");

    // Remove duplicates inside uploaded file
    const uniqueMap = new Map();

    questions.forEach((q) => {
      const key = `${q.questionText.trim()}-${q.role}-${q.difficulty}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, q);
      }
    });

    const uniqueQuestions = Array.from(uniqueMap.values());

    let insertedCount = 0;
    let skippedCount = 0;

    for (let q of uniqueQuestions) {
      const existing = await collection.findOne({
        questionText: q.questionText.trim(),
        role: q.role,
        difficulty: q.difficulty,
        isDeleted: false,
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      await collection.insertOne({
        ...q,
        createdAt: new Date(),
        isDeleted: false,
      });

      insertedCount++;
    }

    res.json({
      totalReceived: questions.length,
      uniqueAfterFileCheck: uniqueQuestions.length,
      inserted: insertedCount,
      skippedDuplicates: skippedCount,
    });
  } catch (err) {
    res.status(500).json({ error: "Server Error" });
  }
});

// MCQ Interview Start API
app.post("/api/mcq/start", async (req, res) => {
  try {
    const { role, difficulty, questionCount, duration } = req.body;

    if (!role || !difficulty) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    console.log("req: ", role, difficulty);
    const questions = await db
      .collection("questions")
      .aggregate([{ $match: { role, difficulty } }, { $sample: { size: parseInt(questionCount) } }])
      .toArray();
    console.log("\n ques: ", questions);
    if (!questions.length) {
      return res.status(404).json({ error: "No questions found" });
    }

    const session = {
      role,
      difficulty,
      duration: parseInt(duration),
      questions: questions.map((q) => ({
        questionId: q._id,
        questionText: q.questionText,
        explanation: q.explanation,
        topic: q.topic,
        options: q.options,
        correctAnswer: q.correctAnswer, // keep for evaluation
        marks: q.marks,
        selectedOption: null,
        isCorrect: null,
      })),
      topicStats: null,
      totalScore: 0,
      maxScore: questions.reduce((sum, q) => sum + q.marks, 0),
      status: "ongoing",
      startedAt: new Date(),
      completedAt: null,
    };

    const result = await db.collection("mcqSessions").insertOne(session);
    console.log("\nsession: ", result);
    res.json({ sessionId: result.insertedId });
  } catch (err) {
    console.error("MCQ Start Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

//  Get Session by ID
app.get("/api/mcq/session/:id", async (req, res) => {
  try {
    const session = await db.collection("mcqSessions").findOne({ _id: new ObjectId(req.params.id) });

    if (!session) return res.status(404).json({ error: "Session not found" });

    res.json(session);
  } catch (err) {
    res.status(500).json({ error: "Invalid session ID" });
  }
});

// Submit Interview
app.post("/api/mcq/submit/:id", async (req, res) => {
  try {
    const { answers } = req.body;
    const session = await db.collection("mcqSessions").findOne({ _id: new ObjectId(req.params.id) });
    if (!session) return res.status(404).json({ error: "Session not found" });

    let totalScore = 0,
      updatedQuestions = [];
    const topicStats = {};

    session.questions.forEach((q) => {
      q.selectedOption = answers[q.questionId];
      if (!topicStats[q.topic]) {
        topicStats[q.topic] = { correct: 0, total: 0 };
      }
      topicStats[q.topic].total++;

      if (answers[q.questionId] === q.correctAnswer) {
        totalScore += 5;
        q.isCorrect = true;
        topicStats[q.topic].correct++;
      } else q.isCorrect = false;
      updatedQuestions.push(q);
    });
    console.log("updated questions: ", updatedQuestions);
    const accuracy = await db.collection("mcqSessions").updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          totalScore,
          questions: updatedQuestions,
          topicStats,
          status: "completed",
          completedAt: new Date(),
        },
      },
    );

    res.json({ totalScore });
  } catch (err) {
    res.status(500).json({ error: "Submission failed" });
  }
});

// REGISTER
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) return res.status(400).json({ error: "All fields are required." });

    const usersCollection = db.collection("users");

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) return res.status(409).json({ error: "User already exists." });

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await usersCollection.insertOne({
      name,
      email,
      password: hashedPassword,
      createdAt: new Date(),
    });

    res.status(201).json({
      message: "User registered successfully.",
      userId: result.insertedId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) return res.status(400).json({ error: "All fields are required." });

    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ error: "No user found with this email." });

    // Check if account is locked
    if (user.lockUntil && user.lockUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockUntil - new Date()) / 1000 / 60);
      return res.status(403).json({
        error: `Account locked due to too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft > 1 ? "s" : ""}.`,
      });
    }

    // Validate password
    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      const failedAttempts = (user.failedLoginAttempts || 0) + 1;
      const MAX_ATTEMPTS = 5;

      if (failedAttempts >= MAX_ATTEMPTS) {
        // Lock the account for 15 minutes
        await usersCollection.updateOne(
          { email },
          {
            $set: {
              failedLoginAttempts: failedAttempts,
              lockUntil: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
            },
          },
        );
        return res.status(403).json({
          error: "Account locked due to too many failed attempts. Try again in 15 minutes.",
        });
      }

      // Not locked yet — increment failed attempts and warn user
      await usersCollection.updateOne({ email }, { $set: { failedLoginAttempts: failedAttempts } });

      const attemptsLeft = MAX_ATTEMPTS - failedAttempts;
      return res.status(401).json({
        error: `Invalid password. ${attemptsLeft} attempt${attemptsLeft > 1 ? "s" : ""} remaining before account is locked.`,
      });
    }

    // Login successful — reset failed attempts
    await usersCollection.updateOne(
      { email },
      {
        $set: { failedLoginAttempts: 0, updatedAt: new Date() },
        $unset: { lockUntil: "" },
      },
    );

    res.status(200).json({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// GOOGLE AUTH
app.post("/api/auth/google", async (req, res) => {
  try {
    const { name, email, googleId, image } = req.body;

    if (!name || !email || !googleId) return res.status(400).json({ error: "Missing required fields." });

    const usersCollection = db.collection("users");

    let user = await usersCollection.findOne({ email });

    if (user) {
      await usersCollection.updateOne({ email }, { $set: { googleId, image, updatedAt: new Date() } });

      return res.status(200).json({
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        image: user.image,
      });
    }

    const result = await usersCollection.insertOne({
      name,
      email,
      googleId,
      image,
      password: null,
      createdAt: new Date(),
    });

    res.status(201).json({
      id: result.insertedId.toString(),
      name,
      email,
      image,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// GET USER BY ID
app.get("/api/users/:id", async (req, res) => {
  try {
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ _id: new ObjectId(req.params.id) }, { projection: { password: 0 } });

    if (!user) return res.status(404).json({ error: "User not found." });

    res.status(200).json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// FORGOT PASSWORD
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) return res.status(400).json({ error: "Email is required." });

    const usersCollection = db.collection("users");
    const user = await usersCollection.findOne({ email });

    if (!user) return res.status(200).json({ message: "If this email exists you will receive a reset link." });

    // OAuth user — no password to reset
    if (!user.password)
      return res.status(400).json({
        error: "This account uses Socials(e.g. Google, Github etc.) to sign in. Please use that to login instead.",
      });

    // Generate a secure random token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour expiry time

    // Save token to MongoDB
    await usersCollection.updateOne({ email }, { $set: { resetToken, resetTokenExpiry } });

    // Build reset link
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    // Setup Nodemailer
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    // Send email
    await transporter.sendMail({
      from: `"ARIMS Support" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Reset Your ARIMS Password",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #4F46E5; padding: 24px; border-radius: 8px 8px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">ARIMS</h1>
            <p style="color: #CADCFC; margin: 4px 0 0;">AI Resume & Interview Mastery System</p>
          </div>
          <div style="background: #f9f9f9; padding: 32px; border-radius: 0 0 8px 8px;">
            <h2 style="color: #1E293B;">Reset Your Password</h2>
            <p style="color: #64748B;">Hi ${user.name}, we received a request to reset your password.</p>
            <p style="color: #64748B;">Click the button below to reset it. This link expires in <strong>1 hour</strong>.</p>
            <a href="${resetLink}" 
               style="display: inline-block; background: #4F46E5; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 16px 0;">
              Reset Password
            </a>
            <p style="color: #94A3B8; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
            <p style="color: #94A3B8; font-size: 12px;">Or copy this link: ${resetLink}</p>
          </div>
        </div>
      `,
    });

    res.status(200).json({ message: "If this email exists you will receive a reset link." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// RESET PASSWORD
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) return res.status(400).json({ error: "Token and password are required." });

    const usersCollection = db.collection("users");

    // Find user with this token and check it hasn't expired
    const user = await usersCollection.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: new Date() }, // token must not be expired
    });

    if (!user) return res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." });

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Update password and remove the reset token
    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: { password: hashedPassword, updatedAt: new Date() },
        $unset: { resetToken: "", resetTokenExpiry: "" }, // clean up token
      },
    );

    res.status(200).json({ message: "Password reset successfully. You can now log in." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// RESUME ANALYZER
app.post("/api/resume/analyze", upload.single("resume"), async (req, res) => {
  try {
    // Check file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: "Please upload a PDF file." });
    }

    // Extract text from PDF
    const uint8Array = new Uint8Array(req.file.buffer);
    const pdfData = await getDocument({ data: uint8Array }).promise;
    let resumeText = "";

    for (let i = 1; i <= pdfData.numPages; i++) {
      const page = await pdfData.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(" ");
      resumeText += pageText + "\n";
    }

    if (!resumeText || resumeText.trim().length === 0) {
      return res.status(400).json({ error: "Could not extract text from PDF. Make sure it is not a scanned image." });
    }

    // Send to Groq
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile", // free and very capable
      messages: [
        {
          role: "system",
          content: `You are an expert ATS (Applicant Tracking System) resume analyzer. 
      Analyze the resume and return a JSON response with exactly this structure:
      {
        "atsScore": <number between 0-100>,
        "scoreBreakdown": {
          "formatting": <number 0-100>,
          "keywords": <number 0-100>,
          "experience": <number 0-100>,
          "education": <number 0-100>,
          "skills": <number 0-100>
        },
        "strengths": [<list of 3-5 strong points as strings>],
        "weaknesses": [<list of 3-5 weak points as strings>],
        "improvements": [<list of 5 specific actionable suggestions as strings>],
        "missingKeywords": [<list of important missing keywords as strings>],
        "summary": "<2-3 sentence overall summary>"
      }
      Return ONLY the JSON object, no extra text, no markdown backticks.`,
        },
        {
          role: "user",
          content: `Analyze this resume:\n\n${resumeText}`,
        },
      ],
      temperature: 0.3,
    });

    // Parse Groq response
    const rawResponse = completion.choices[0].message.content;
    const analysis = JSON.parse(rawResponse);

    // Save to MongoDB
    const resumesCollection = db.collection("resumes");
    await resumesCollection.insertOne({
      userId: req.body.userId || null,
      fileName: req.file.originalname,
      analysis,
      createdAt: new Date(),
    });

    res.status(200).json({ success: true, analysis });
  } catch (err) {
    console.error(err);
    if (err.message === "Only PDF files are allowed.") {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Something went wrong analyzing your resume." });
  }
});

//  Start Server
connectDB().then(() => {
  app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
});
