const express = require('express')
const cors = require('cors')
require('dotenv').config()
const port = process.env.PORT || 5000

const app = express()
app.use(cors())
app.use(express.json())


app.get('/', (req, res) => {
    res.send("Hello from backend")
})



//  Resume Genarator //

app.post("/api/resume", (req, res) => {
    try {
        const { personalInfo, summary, skills, experiences, projects, certifications } = req.body;

        const doc = new PDFDocument({ margin: 50 });

        res.setHeader("Content-Disposition", "attachment; filename=resume.pdf");
        res.setHeader("Content-Type", "application/pdf");

        doc.pipe(res);

        // Resonal Info
        doc.fontSize(24).fillColor("#111827").text(personalInfo.fullName || "Your Name", { align: "center" });
        doc.fontSize(10).fillColor("#6B7280")
            .text(`${personalInfo.email || ""} | ${personalInfo.phone || ""} | ${personalInfo.location || ""}`, { align: "center" });
        doc.moveDown(1.5);

        // PROFESSIONAL 
        doc.fontSize(14).fillColor("#111827").text("PROFESSIONAL SUMMARY", { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor("#374151").text(summary || "No summary provided.", { lineGap: 4 });
        doc.moveDown();

        // SKILLS 
        doc.fontSize(14).fillColor("#111827").text("SKILLS", { underline: true });
        doc.moveDown(0.5);
        skills.split(",").map(s => s.trim()).filter(s => s).forEach(skill => doc.fontSize(11).text(`• ${skill}`));
        doc.moveDown();

        //  WORK EXPERIENCE 
        doc.fontSize(14).fillColor("#111827").text("WORK EXPERIENCE", { underline: true });
        doc.moveDown(0.5);
        experiences.forEach(exp => {
            if (!exp.company && !exp.role) return;
            doc.fontSize(12).fillColor("#111827").text(`${exp.role || "Role"} — ${exp.company || "Company"}`);
            doc.fontSize(10).fillColor("#6B7280").text(`(${exp.startDate || "Start"} - ${exp.endDate || "End"})`);
            doc.fontSize(11).fillColor("#374151").text(exp.description || "No description provided.", { lineGap: 3 });
            doc.moveDown();
        });

        //  PROJECTS 
        doc.fontSize(14).fillColor("#111827").text("PROJECTS", { underline: true });
        doc.moveDown(0.5);
        projects.forEach(proj => {
            if (!proj.name) return;
            doc.fontSize(12).fillColor("#111827").text(proj.name);
            if (proj.link) doc.fontSize(10).fillColor("#2563EB").text(proj.link);
            doc.fontSize(11).fillColor("#374151").text(proj.description || "");
            doc.moveDown();
        });

        // CERTIFICATIONS 
        doc.fontSize(14).fillColor("#111827").text("CERTIFICATIONS", { underline: true });
        doc.moveDown(0.5);
        certifications.forEach(cert => {
            if (!cert.name) return;
            doc.fontSize(11).text(`• ${cert.name} — ${cert.org || ""} (${cert.date || ""})`);
        });

        doc.end();
    } catch (err) {
        console.error("PDF ERROR:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});


app.listen(port, () => {
    console.log(`Server running on ${port}`)
})