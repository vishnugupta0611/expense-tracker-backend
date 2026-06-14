const Job = require('../models/Job');
const JobProfile = require('../models/JobProfile');
const JobHistory = require('../models/JobHistory');
const AutomatedTask = require('../models/AutomatedTask');
const Exa = require('exa-js');
const https = require('https');
const pdfParse = require('pdf-parse');
const { getStatus, sendWhatsAppMessage } = require('../services/whatsappService');
const { applyToJobsForUser, selectBestResume, generateOutreach, gemini, fetchHtmlContent, cleanHtml, extractContactDetailsWithRegex } = require('../services/cronService');

const getExaClient = (profileKey) => {
  const key = profileKey || process.env.EXA_API_KEY;
  if (!key) return null;
  // Handle CommonJS require mapping for exa-js
  if (typeof Exa === 'function') {
    return new Exa(key);
  } else if (Exa.default && typeof Exa.default === 'function') {
    return new Exa.default(key);
  } else if (typeof Exa.default === 'object') {
    return new Exa.default(key);
  }
  return null;
};

// ── Profile Controllers ──────────────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    let profile = await JobProfile.findOne({ userId: req.userId });
    if (!profile) {
      profile = new JobProfile({ userId: req.userId, targetRoles: [] });
      await profile.save();
    }
    res.json(profile);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { userName, userEmail, userPhone, targetRoles, experienceLevel, targetLocation, resumeText, exaApiKey } = req.body;
    let profile = await JobProfile.findOne({ userId: req.userId });
    
    if (!profile) {
      profile = new JobProfile({ userId: req.userId });
    }

    profile.userName = userName;
    profile.userEmail = userEmail;
    profile.userPhone = userPhone;
    profile.targetRoles = targetRoles;
    profile.experienceLevel = experienceLevel;
    profile.targetLocation = targetLocation;
    profile.resumeText = resumeText;
    profile.exaApiKey = exaApiKey;

    await profile.save();
    res.json(profile);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

// ── Search History Controllers ──────────────────────────────────────────────
const getHistory = async (req, res) => {
  try {
    const history = await JobHistory.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(30);
    res.json(history);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Failed to get search history' });
  }
};

// ── Job Management CRUD ──────────────────────────────────────────────────────
const getJobs = async (req, res) => {
  try {
    const jobs = await Job.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json(jobs);
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Failed to get jobs' });
  }
};

const createJob = async (req, res) => {
  try {
    const { title, company, url, description, contactNumber, contactEmail, status, notes, contactNumbers, contactEmails } = req.body;
    
    const job = new Job({
      userId: req.userId,
      title,
      company,
      url,
      description,
      contactNumber,
      contactEmail,
      contactNumbers: contactNumbers || (contactNumber ? [contactNumber] : []),
      contactEmails: contactEmails || (contactEmail ? [contactEmail] : []),
      status: status || 'to-apply',
      notes,
    });

    await job.save();
    res.status(201).json(job);
  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({ error: 'Failed to create job' });
  }
};

const updateJob = async (req, res) => {
  try {
    const { title, company, url, description, contactNumber, contactEmail, status, notes, aiWhatsAppMsg, aiEmailSubject, aiEmailBody, contactNumbers, contactEmails } = req.body;
    const job = await Job.findOne({ _id: req.params.id, userId: req.userId });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (title) job.title = title;
    if (company) job.company = company;
    if (url) job.url = url;
    if (description) job.description = description;
    
    if (contactNumber) {
      job.contactNumber = contactNumber;
      if (!job.contactNumbers) job.contactNumbers = [];
      if (!job.contactNumbers.includes(contactNumber)) {
        job.contactNumbers.push(contactNumber);
      }
    }
    if (contactEmail) {
      job.contactEmail = contactEmail;
      if (!job.contactEmails) job.contactEmails = [];
      if (!job.contactEmails.includes(contactEmail)) {
        job.contactEmails.push(contactEmail);
      }
    }
    if (contactNumbers) {
      job.contactNumbers = contactNumbers;
      if (contactNumbers.length > 0 && !job.contactNumber) {
        job.contactNumber = contactNumbers[0];
      }
    }
    if (contactEmails) {
      job.contactEmails = contactEmails;
      if (contactEmails.length > 0 && !job.contactEmail) {
        job.contactEmail = contactEmails[0];
      }
    }
    if (status) {
      job.status = status;
      if (status === 'applied' && !job.appliedAt) {
        job.appliedAt = new Date();
      }
    }
    if (notes !== undefined) job.notes = notes;
    if (aiWhatsAppMsg) job.aiWhatsAppMsg = aiWhatsAppMsg;
    if (aiEmailSubject) job.aiEmailSubject = aiEmailSubject;
    if (aiEmailBody) job.aiEmailBody = aiEmailBody;

    await job.save();
    res.json(job);
  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({ error: 'Failed to update job' });
  }
};

const deleteJob = async (req, res) => {
  try {
    const job = await Job.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({ error: 'Failed to delete job' });
  }
};

// ── Search & Scraper Controllers ─────────────────────────────────────────────
const searchByTerm = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Query term is required' });
    }

    const profile = await JobProfile.findOne({ userId: req.userId });
    const exaClient = getExaClient(profile?.exaApiKey);

    if (!exaClient) {
      return res.status(400).json({ error: 'Exa API Key is missing. Please set it in target configurations!' });
    }

    const searchQuery = `${query} job openings career page`;
    const searchRes = await exaClient.search(searchQuery, {
      type: 'auto',
      numResults: 10,
      contents: { highlights: true }
    });

    const results = searchRes.results || [];
    
    // Log history
    const history = new JobHistory({
      userId: req.userId,
      searchType: 'term',
      query,
      resultsCount: results.length
    });
    await history.save();

    res.json({ results });
  } catch (error) {
    console.error('Search by term error:', error);
    res.status(500).json({ error: error.message || 'Exa search failed' });
  }
};

const searchByUrl = async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Careers site URL is required' });
    }

    const profile = await JobProfile.findOne({ userId: req.userId });
    const exaClient = getExaClient(profile?.exaApiKey);

    if (!exaClient) {
      return res.status(400).json({ error: 'Exa API Key is missing. Please set it in target configurations!' });
    }

    // 1. Fetch contents (Built-in fetch to save Exa credits)
    let pageText = '';
    try {
      const html = await fetchHtmlContent(url);
      pageText = cleanHtml(html);
    } catch (scrapeError) {
      console.warn('Built-in scraper failed, trying Exa fallback:', scrapeError.message);
      try {
        const contentsRes = await exaClient.getContents([url], {
          text: { maxCharacters: 15000, verbosity: 'compact' }
        });
        pageText = contentsRes.results?.[0]?.text || '';
      } catch (exaError) {
        console.error('Exa scrape fallback failed:', exaError.message);
      }
    }

    if (!pageText || !pageText.trim()) {
      return res.status(422).json({ error: 'Could not scrape page text. Check if the URL is valid.' });
    }

    // 2. Parse details via Gemini
    const parserPrompt = `Analyze this careers site page text. Extract:
1. What the company does (short summary).
2. List of available job openings (max 5 main titles).
3. Hires freshers: (Yes / No / Unknown) - provide a brief explanation.
4. All recruiter contact email addresses as a JSON array of strings (if visible).
5. All recruiter contact phone or WhatsApp numbers as a JSON array of strings (if visible).
6. Company name.

Careers Site Page Content:
${pageText}

Respond ONLY with valid JSON structure, no markdown, no explanation:
{
  "companyName": "...",
  "aboutCompany": "...",
  "availableJobs": ["...", "..."],
  "hiresFreshers": "Yes/No/Unknown",
  "fresherExplanation": "...",
  "contactEmails": ["...", "..."],
  "contactPhones": ["...", "..."]
}`;

    let parsedDetails = {};
    try {
      const parsedText = await gemini(parserPrompt);
      const clean = parsedText.replace(/```json?/gi, '').replace(/```/g, '').trim();
      parsedDetails = JSON.parse(clean);
    } catch (parserErr) {
      console.warn('Gemini parsing failed, fallback used:', parserErr);
      parsedDetails = {
        companyName: url.replace(/https?:\/\/(www\.)?/, '').split('.')[0],
        aboutCompany: 'Scraped successfully. Review details in original link.',
        availableJobs: [],
        hiresFreshers: 'Unknown',
        fresherExplanation: 'Parsing details timed out.',
        contactEmails: [],
        contactPhones: []
      };
    }

    // Populate single fields if not populated
    if (parsedDetails.contactEmails && parsedDetails.contactEmails.length > 0) {
      parsedDetails.contactEmail = parsedDetails.contactEmails[0];
    } else {
      parsedDetails.contactEmails = [];
    }
    if (parsedDetails.contactPhones && parsedDetails.contactPhones.length > 0) {
      parsedDetails.contactPhone = parsedDetails.contactPhones[0];
    } else {
      parsedDetails.contactPhones = [];
    }

    // Merge with regex-based extraction to improve reliability
    try {
      const regexContacts = extractContactDetailsWithRegex(pageText);
      regexContacts.emails.forEach(email => {
        if (!parsedDetails.contactEmails.includes(email)) {
          parsedDetails.contactEmails.push(email);
        }
      });
      regexContacts.phones.forEach(phone => {
        if (!parsedDetails.contactPhones.includes(phone)) {
          parsedDetails.contactPhones.push(phone);
        }
      });
      if (parsedDetails.contactEmails.length > 0) {
        parsedDetails.contactEmail = parsedDetails.contactEmails[0];
      }
      if (parsedDetails.contactPhones.length > 0) {
        parsedDetails.contactPhone = parsedDetails.contactPhones[0];
      }
    } catch (regexErr) {
      console.warn('Regex extraction failed in searchByUrl:', regexErr);
    }

    // 3. Query LinkedIn / Reddit for feedback
    const company = parsedDetails.companyName || 'this company';
    const feedbackQuery = `site:reddit.com OR site:linkedin.com reviews feedback for ${company} work culture salary`;
    
    let reviewsSummary = 'No reviews found on Reddit/LinkedIn.';
    try {
      const searchRes = await exaClient.search(feedbackQuery, {
        type: 'auto',
        numResults: 5,
        contents: { highlights: true }
      });
      const results = searchRes.results || [];
      if (results.length > 0) {
        const feedbackPrompt = `Summarize Reddit/LinkedIn feedback and reviews for the company "${company}" based on these search results:
${results.map(r => `Title: ${r.title}\nURL: ${r.url}\nHighlights: ${r.highlights?.join('\n') || ''}`).join('\n\n')}

Create a professional, objective summary of the work culture, salary satisfaction, and pros/cons mentioned by users. Maximum 150 words.`;
        const summarized = await gemini(feedbackPrompt);
        reviewsSummary = summarized.trim();
      }
    } catch (reviewsErr) {
      console.warn('Reviews extraction failed:', reviewsErr.message);
    }

    const finalResult = {
      ...parsedDetails,
      reviewsSummary,
      url
    };

    // Log history
    const history = new JobHistory({
      userId: req.userId,
      searchType: 'url',
      query: url,
      resultsCount: 1
    });
    await history.save();

    res.json(finalResult);
  } catch (error) {
    console.error('Search by URL error:', error);
    res.status(500).json({ error: error.message || 'Exa URL scraping failed' });
  }
};

// ── WhatsApp Outbox / Status ────────────────────────────────────────────────
const getWhatsAppStatus = (req, res) => {
  res.json(getStatus());
};

// ── Manual Cron Trigger (for instant testing) ────────────────────────────────
const triggerManualApply = async (req, res) => {
  try {
    const count = await applyToJobsForUser(req.userId);
    res.json({ message: 'Triggered cron job successfully!', appliedCount: count });
  } catch (error) {
    console.error('Manual apply trigger error:', error);
    res.status(500).json({ error: 'Failed to run manual outreach' });
  }
};

// ── Manual Outreach Composer Draft ───────────────────────────────────────────
const generateManualDraft = async (req, res) => {
  try {
    const { title, company, description, resumeId } = req.body;
    if (!title || !company) {
      return res.status(400).json({ error: 'Job title and company name are required' });
    }

    const profile = await JobProfile.findOne({ userId: req.userId });
    if (!profile) {
      return res.status(404).json({ error: 'Please configure your profile first!' });
    }

    let selectedResume = null;
    if (resumeId && profile.resumes) {
      selectedResume = profile.resumes.id(resumeId);
    }

    const outreach = await generateOutreach(profile, { title, company, description }, selectedResume);
    res.json(outreach);
  } catch (error) {
    console.error('Generate manual draft error:', error);
    res.status(500).json({ error: error.message || 'Failed to compose manual outreach' });
  }
};

// ── PDF Resume Upload & Parsing ──────────────────────────────────────────────
const uploadResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let text = '';
    if (req.file.mimetype === 'application/pdf') {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: req.file.buffer });
      const result = await parser.getText();
      text = result.text;
    } else if (req.file.mimetype === 'text/plain') {
      text = req.file.buffer.toString('utf-8');
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Please upload a PDF or TXT file.' });
    }

    if (!text.trim()) {
      return res.status(422).json({ error: 'Extracted text is empty. The PDF might be scanned or empty.' });
    }

    // Call Gemini to parse and extract summary + skills
    const prompt = `You are an expert resume parsing assistant. Analyze this candidate resume text and extract:
1. Complete, clear, and comprehensive candidate profile Summary/Highlights (focusing on tech stack, projects, experience).
2. Key Skills / Languages / Frameworks (as a comma-separated list of strings).

Resume Text:
${text}

Respond ONLY with valid JSON structure, no markdown, no explanation:
{
  "summary": "Detailed summary highlighting key projects, stacks, and overall experience",
  "skills": ["Skill1", "Skill2", "Skill3"]
}`;

    const aiResponse = await gemini(prompt);
    const clean = aiResponse.replace(/```json?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);

    let profile = await JobProfile.findOne({ userId: req.userId });
    if (!profile) {
      profile = new JobProfile({ userId: req.userId, resumes: [] });
    }

    const newResume = {
      name: req.file.originalname.replace(/\.[^/.]+$/, ""), // file name without ext
      summary: parsed.summary,
      skills: parsed.skills || []
    };

    profile.resumes.push(newResume);
    await profile.save();

    res.status(201).json(profile);
  } catch (error) {
    console.error('Upload resume error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload and parse resume' });
  }
};

const deleteResume = async (req, res) => {
  try {
    const { resumeId } = req.params;
    const profile = await JobProfile.findOne({ userId: req.userId });
    if (!profile) {
      return res.status(404).json({ error: 'Job profile not found' });
    }

    profile.resumes = profile.resumes.filter(r => r._id.toString() !== resumeId);
    await profile.save();
    res.json(profile);
  } catch (error) {
    console.error('Delete resume error:', error);
    res.status(500).json({ error: 'Failed to delete resume' });
  }
};

// ── Manual Outreach Generation ──────────────────────────────────────────────
const generateJobOutreach = async (req, res) => {
  try {
    const { id } = req.params;
    const { resumeId } = req.body;
    const job = await Job.findOne({ _id: id, userId: req.userId });
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const profile = await JobProfile.findOne({ userId: req.userId });
    if (!profile) {
      return res.status(404).json({ error: 'Please configure your profile first!' });
    }

    // If contact details are missing and we have a url, try to scrape and extract them first!
    if (job.url && (!job.contactEmail || !job.contactNumber || !job.contactEmails || job.contactEmails.length === 0 || !job.contactNumbers || job.contactNumbers.length === 0)) {
      try {
        const html = await fetchHtmlContent(job.url);
        const text = cleanHtml(html);
        
        // Regex extraction first
        const regexContacts = extractContactDetailsWithRegex(text);
        if (!job.contactEmails) job.contactEmails = [];
        regexContacts.emails.forEach(email => {
          if (!job.contactEmails.includes(email)) {
            job.contactEmails.push(email);
          }
        });
        if (job.contactEmails.length > 0 && !job.contactEmail) {
          job.contactEmail = job.contactEmails[0];
        }

        if (!job.contactNumbers) job.contactNumbers = [];
        regexContacts.phones.forEach(phone => {
          if (!job.contactNumbers.includes(phone)) {
            job.contactNumbers.push(phone);
          }
        });
        if (job.contactNumbers.length > 0 && !job.contactNumber) {
          job.contactNumber = job.contactNumbers[0];
        }

        // Then try AI extraction
        const extractPrompt = `Analyze this page text from a careers site or job posting. Extract:
1. All recruiter contact email addresses (if visible).
2. All recruiter contact phone or WhatsApp numbers (if visible).

Page Text:
${text}

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "emails": ["extracted email 1", "extracted email 2"],
  "phones": ["extracted phone 1", "extracted phone 2"]
}`;
        const raw = await gemini(extractPrompt);
        const match = raw.match(/\{[\s\S]*?\}/);
        const clean = match ? match[0] : raw;
        const parsed = JSON.parse(clean);
        if (parsed.emails && Array.isArray(parsed.emails)) {
          parsed.emails.forEach(email => {
            if (!job.contactEmails.includes(email)) {
              job.contactEmails.push(email);
            }
          });
        }
        if (parsed.phones && Array.isArray(parsed.phones)) {
          parsed.phones.forEach(phone => {
            if (!job.contactNumbers.includes(phone)) {
              job.contactNumbers.push(phone);
            }
          });
        }
        if (job.contactEmails.length > 0 && !job.contactEmail) {
          job.contactEmail = job.contactEmails[0];
        }
        if (job.contactNumbers.length > 0 && !job.contactNumber) {
          job.contactNumber = job.contactNumbers[0];
        }
      } catch (err) {
        console.warn('Failed to extract contact details in generateJobOutreach:', err.message);
      }
    }

    // Select target resume: custom selected or auto-select best match
    let selectedResume = null;
    if (resumeId && profile.resumes) {
      selectedResume = profile.resumes.id(resumeId);
    } else if (profile.resumes && profile.resumes.length > 0) {
      selectedResume = await selectBestResume(profile.resumes, job);
    }

    // Generate outreach template
    const outreach = await generateOutreach(profile, job, selectedResume);

    job.aiWhatsAppMsg = outreach.whatsAppMsg;
    job.aiEmailSubject = outreach.emailSubject;
    job.aiEmailBody = outreach.emailBody;
    
    if (selectedResume) {
      job.appliedResumeId = selectedResume._id;
      job.appliedResumeName = selectedResume.name;
    }

    await job.save();
    res.json(job);
  } catch (error) {
    console.error('Generate outreach error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate outreach' });
  }
};

// ── Automated Scheduler Tasks CRUD ───────────────────────────────────────────
const getTasks = async (req, res) => {
  try {
    const tasks = await AutomatedTask.find({ userId: req.userId }).sort({ time: 1 });
    res.json(tasks);
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
};

const createTask = async (req, res) => {
  try {
    const { type, time, data } = req.body;
    if (!type || !time) {
      return res.status(400).json({ error: 'Type and time are required' });
    }

    const task = new AutomatedTask({
      userId: req.userId,
      type,
      time,
      data: data || {},
    });

    await task.save();
    res.status(201).json(task);
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
};

const toggleTask = async (req, res) => {
  try {
    const { id } = req.params;
    const task = await AutomatedTask.findOne({ _id: id, userId: req.userId });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    task.isActive = !task.isActive;
    await task.save();
    res.json(task);
  } catch (error) {
    console.error('Toggle task error:', error);
    res.status(500).json({ error: 'Failed to toggle task status' });
  }
};

const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;
    const task = await AutomatedTask.findOneAndDelete({ _id: id, userId: req.userId });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
};

const connectWhatsApp = (req, res) => {
  try {
    const { initWhatsApp, getStatus } = require('../services/whatsappService');
    initWhatsApp();
    res.json(getStatus());
  } catch (error) {
    console.error('Failed to connect WhatsApp:', error);
    res.status(500).json({ error: 'Failed to initialize WhatsApp connection' });
  }
};

const disconnectWhatsApp = async (req, res) => {
  try {
    const { logoutWhatsApp, getStatus } = require('../services/whatsappService');
    await logoutWhatsApp();
    res.json(getStatus());
  } catch (error) {
    console.error('Failed to disconnect WhatsApp:', error);
    res.status(500).json({ error: 'Failed to destroy WhatsApp connection' });
  }
};

const sendJobWhatsApp = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findOne({ _id: id, userId: req.userId });
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const phones = job.contactNumbers && job.contactNumbers.length > 0 ? job.contactNumbers : (job.contactNumber ? [job.contactNumber] : []);
    if (phones.length === 0) {
      return res.status(400).json({ error: 'Job does not have any contact numbers' });
    }

    if (!job.aiWhatsAppMsg) {
      return res.status(400).json({ error: 'AI WhatsApp message is not generated yet' });
    }

    const { getStatus, sendWhatsAppMessage } = require('../services/whatsappService');
    const wsStatus = getStatus().status;
    if (wsStatus !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp client is offline. Please link your WhatsApp first!' });
    }

    // Send to ALL numbers
    let sentCount = 0;
    let errors = [];
    for (const phone of phones) {
      try {
        await sendWhatsAppMessage(phone, job.aiWhatsAppMsg);
        sentCount++;
      } catch (wsErr) {
        console.error(`Failed to send automated WhatsApp to ${phone}:`, wsErr.message);
        errors.push(`${phone}: ${wsErr.message}`);
      }
    }

    if (sentCount === 0) {
      return res.status(500).json({ error: `Failed to send WhatsApp message to any numbers: ${errors.join(', ')}` });
    }
    
    job.status = 'applied';
    if (!job.appliedAt) {
      job.appliedAt = new Date();
    }
    await job.save();

    res.json(job);
  } catch (error) {
    console.error('Send job WhatsApp error:', error);
    res.status(500).json({ error: error.message || 'Failed to send WhatsApp message' });
  }
};

const deepScrapeJob = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findOne({ _id: id, userId: req.userId });
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (!job.url) {
      return res.status(400).json({ error: 'Job does not have a careers site URL' });
    }

    const { crawlAndExtractContacts } = require('../services/cronService');
    console.log(`[DeepScrape] Starting deep same-domain crawl (up to 20 pages) for: ${job.url}`);
    
    const crawlResult = await crawlAndExtractContacts(job.url);

    // Update job model fields
    if (!job.contactEmails) job.contactEmails = [];
    crawlResult.emails.forEach(email => {
      if (!job.contactEmails.includes(email)) {
        job.contactEmails.push(email);
      }
    });
    if (job.contactEmails.length > 0 && !job.contactEmail) {
      job.contactEmail = job.contactEmails[0];
    }

    if (!job.contactNumbers) job.contactNumbers = [];
    crawlResult.phones.forEach(phone => {
      if (!job.contactNumbers.includes(phone)) {
        job.contactNumbers.push(phone);
      }
    });
    if (job.contactNumbers.length > 0 && !job.contactNumber) {
      job.contactNumber = job.contactNumbers[0];
    }

    await job.save();
    console.log(`[DeepScrape] Scraped successfully. Emails: ${job.contactEmails.length}, Phones: ${job.contactNumbers.length}`);
    res.json(job);
  } catch (error) {
    console.error('Deep scrape job error:', error);
    res.status(500).json({ error: error.message || 'Failed to deeply scrape careers page' });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  getHistory,
  getJobs,
  createJob,
  updateJob,
  deleteJob,
  searchByTerm,
  searchByUrl,
  getWhatsAppStatus,
  triggerManualApply,
  uploadResume,
  deleteResume,
  generateJobOutreach,
  generateManualDraft,
  getTasks,
  createTask,
  toggleTask,
  deleteTask,
  connectWhatsApp,
  disconnectWhatsApp,
  sendJobWhatsApp,
  deepScrapeJob,
};
