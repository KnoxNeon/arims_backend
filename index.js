import dotenv from "dotenv";
dotenv.config();

import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import express from "express";
import cors from "cors";
import Groq from 'groq-sdk';

// Groq Setup
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const app = express();
const port = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  "http://localhost:3000",
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
    db = client.db("arims");
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



/**
 * AI Explanation / Feedback Endpoint
 * Accepts: questionText, correctAnswer, userAnswer
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
      ...req.body,
      updatedAt: new Date(),
      $inc: { version: 1 },
    };

    const result = await db.collection("questions").updateOne(
      { _id: new ObjectId(req.params.id) },
      {
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
        $inc: { version: 1 },
      },
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

// app.post("/api/admin/questions/bulk", async (req, res) => {
//   try {
//     const questions = req.body;

//     if (!Array.isArray(questions)) return res.status(400).json({ error: "Array required" });

//     const preparedQuestions = questions.map((q) => ({
//       ...q,
//       createdAt: new Date(),
//       updatedAt: new Date(),
//       version: 1,
//       isDeleted: false,
//       status: q.status || "active",
//     }));

//     await db.collection("questions").insertMany(preparedQuestions);

//     res.json({ message: "Bulk insert successful" });
//   } catch (err) {
//     res.status(500).json({ error: "Server Error" });
//   }
// });
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

//  Start Server
connectDB().then(() => {
  app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
});
