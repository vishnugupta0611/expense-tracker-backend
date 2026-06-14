const cron = require('node-cron');
const Job = require('../models/Job');
const JobProfile = require('../models/JobProfile');
const AutomatedTask = require('../models/AutomatedTask');
const { sendWhatsAppMessage, getStatus } = require('./whatsappService');
const https = require('https');
const http = require('http');

const fetchHtmlContent = (url) => {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: 10000
      };
      client.get(url, options, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            const targetUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, url).toString();
            return fetchHtmlContent(targetUrl).then(resolve).catch(reject);
          }
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Failed to fetch page: Status ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => { resolve(data); });
      }).on('error', (err) => {
        reject(err);
      });
    } catch (e) {
      reject(e);
    }
  });
};

const extractContactDetailsWithRegex = (text) => {
  const result = { email: '', phone: '', emails: [], phones: [] };
  if (!text) return result;
  
  // Find emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
  const emailsMatch = text.match(emailRegex);
  if (emailsMatch && emailsMatch.length > 0) {
    const uniqueEmails = Array.from(new Set(emailsMatch.map(e => e.toLowerCase().trim())))
      .filter(e => !e.startsWith('example') && !e.includes('placeholder') && !e.endsWith('.png') && !e.endsWith('.jpg'));
    result.emails = uniqueEmails;
    if (uniqueEmails.length > 0) {
      result.email = uniqueEmails[0];
    }
  }
  
  // Find phone/WhatsApp numbers
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+91[-.\s]?\d{10}|\b\d{10}\b/g;
  const phonesMatch = text.match(phoneRegex);
  if (phonesMatch && phonesMatch.length > 0) {
    const cleanedPhones = phonesMatch.map(p => p.trim()).filter(p => {
      const digits = p.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 15;
    });
    const uniquePhones = Array.from(new Set(cleanedPhones));
    result.phones = uniquePhones;
    if (uniquePhones.length > 0) {
      result.phone = uniquePhones[0];
    }
  }
  
  return result;
};

const cleanHtml = (html) => {
  if (!html) return '';
  let clean = html.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '');
  clean = clean.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '');
  clean = clean.replace(/<!--([\s\S]*?)-->/g, '');
  clean = clean.replace(/<[^>]+>/g, ' ');
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean.substring(0, 15000);
};


const crawlAndExtractContacts = async (startUrl) => {
  const puppeteer = require('puppeteer');
  const foundEmails = [];
  const foundPhones = [];
  const visited = new Set();
  const queue = [startUrl];
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setDefaultNavigationTimeout(15000);
    
    let targetDomain = '';
    try {
      targetDomain = new URL(startUrl).hostname.replace('www.', '');
    } catch (e) {
      console.warn('[CrawlAndExtract] Invalid start URL:', startUrl);
      if (browser) await browser.close();
      return { emails: [], phones: [] };
    }

    const extractFromText = (text) => {
      if (!text) return;
      // Find emails
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
      const emailsMatch = text.match(emailRegex);
      if (emailsMatch) {
        emailsMatch.forEach(e => {
          const email = e.toLowerCase().trim();
          if (!email.startsWith('example') && !email.includes('placeholder') && !email.endsWith('.png') && !email.endsWith('.jpg')) {
            if (!foundEmails.includes(email)) foundEmails.push(email);
          }
        });
      }
      
      // Find phone numbers
      const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+91[-.\s]?\d{10}|\b\d{10}\b/g;
      const phonesMatch = text.match(phoneRegex);
      if (phonesMatch) {
        phonesMatch.forEach(p => {
          const phone = p.trim();
          const digits = phone.replace(/\D/g, '');
          if (digits.length >= 10 && digits.length <= 15) {
            if (!foundPhones.includes(phone)) foundPhones.push(phone);
          }
        });
      }
    };

    while (queue.length > 0 && visited.size < 20) {
      const currentUrl = queue.shift();
      if (visited.has(currentUrl)) continue;
      visited.add(currentUrl);

      console.log(`[CrawlAndExtract] Scraped ${visited.size}/20 pages. Crawling: ${currentUrl}`);
      try {
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const text = await page.evaluate(() => document.body.innerText);
        extractFromText(text);

        // Break early if we found at least 1 email OR 1 phone number
        if (foundEmails.length > 0 || foundPhones.length > 0) {
          console.log(`[CrawlAndExtract] Break early! Found email: ${foundEmails[0] || 'none'} or phone: ${foundPhones[0] || 'none'}`);
          break;
        }

        // Extract links on same domain
        const pageLinks = await page.evaluate((domain) => {
          const anchors = Array.from(document.querySelectorAll('a'));
          return anchors
            .map(a => a.href)
            .filter(href => {
              if (!href || !href.startsWith('http')) return false;
              try {
                const urlObj = new URL(href);
                const host = urlObj.hostname.replace(/^www\./i, '');
                return host === domain || host.endsWith('.' + domain);
              } catch (e) {
                return false;
              }
            });
        }, targetDomain);

        for (const link of pageLinks) {
          // Normalize (strip hash)
          const normalized = link.split('#')[0];
          if (!visited.has(normalized) && !queue.includes(normalized)) {
            queue.push(normalized);
          }
        }
      } catch (err) {
        console.warn(`[CrawlAndExtract] Failed to scrape: ${currentUrl} - ${err.message}`);
      }
    }

    await browser.close();
  } catch (err) {
    if (browser) await browser.close();
    console.error(`[CrawlAndExtract] Error during crawl:`, err);
  }

  return {
    emails: foundEmails,
    phones: foundPhones
  };
};


// ── Gemini helper ────────────────────────────────────────────────────────────
const gemini = (prompt) => new Promise((resolve, reject) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return reject(new Error('GEMINI_API_KEY is not defined'));

  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) resolve(text);
        else reject(new Error(parsed.error?.message || 'No response from Gemini'));
      } catch (e) { reject(e); }
    });
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});

// ── AI Resume Matching Selector ──────────────────────────────────────────────
const selectBestResume = async (resumes, job) => {
  if (!resumes || resumes.length === 0) return null;
  if (resumes.length === 1) return resumes[0];

  const resumesList = resumes.map((r, i) => {
    const skillsList = r.skills && r.skills.length > 0 ? r.skills.join(', ') : 'None';
    return `Resume #${i + 1} Name: ${r.name}\nSkills: ${skillsList}\nSummary: ${r.summary}`;
  }).join('\n\n');

  const prompt = `You are an AI recruitment matchmaker. Choose the single best resume from this candidate's resumes list for the following job opening:
Job Title: ${job.title}
Company: ${job.company}
Job Description: ${job.description || 'Not provided'}

Candidate Resumes:
${resumesList}

Respond ONLY with a JSON object in this format (no explanations, no markdown, no text outside JSON):
{
  "bestIndex": 1
}`;

  try {
    const raw = await gemini(prompt);
    console.log('[selectBestResume] Gemini response:', raw);
    const match = raw.match(/\{[\s\S]*?\}/);
    const clean = match ? match[0] : raw;
    const parsed = JSON.parse(clean);
    
    // Robust key matching
    let bestIdxVal = parsed.bestIndex !== undefined ? parsed.bestIndex : (parsed.index !== undefined ? parsed.index : parsed.bestResumeIndex);
    
    let idx = parseInt(bestIdxVal, 10);
    if (isNaN(idx) && typeof bestIdxVal === 'string') {
      const numMatch = bestIdxVal.match(/\d+/);
      if (numMatch) {
        idx = parseInt(numMatch[0], 10);
      }
    }
    
    idx = idx - 1; // 1-based index to 0-based
    if (idx >= 0 && idx < resumes.length) {
      console.log(`[selectBestResume] Selected Resume: ${resumes[idx].name} (Index: ${idx})`);
      return resumes[idx];
    }
  } catch (err) {
    console.error('Failed to select best resume via Gemini:', err);
  }
  return resumes[0]; // fallback
};

const generateOutreach = async (profile, job, selectedResume = null) => {
  const resumeSummary = selectedResume ? selectedResume.summary : (profile.resumeText || 'Enthusiastic developer');
  const resumeSkills = selectedResume && selectedResume.skills ? selectedResume.skills.join(', ') : (profile.targetRoles ? profile.targetRoles.join(', ') : '');

  const prompt = `You are an AI Job application assistant. Create a highly professional outreach email and a short WhatsApp message for this job:
Job Title: ${job.title}
Company: ${job.company}
Job Description: ${job.description || 'Not provided'}

User Profile:
Name: ${profile.userName || 'Applicant'}
Email: ${profile.userEmail || ''}
Phone: ${profile.userPhone || ''}
Target Roles: ${profile.targetRoles ? profile.targetRoles.join(', ') : ''}
Experience Level: ${profile.experienceLevel} (fresher or experienced)
Target Location: ${profile.targetLocation || 'Not specified'}
Selected Resume Profile Skills: ${resumeSkills}
Selected Resume Profile Summary: ${resumeSummary}

Respond ONLY with valid JSON matching this structure, no markdown, no explanation:
{
  "emailSubject": "Subject line for the application email",
  "emailBody": "Write a decent, simple, professional application email body. Address it properly, highlight the candidate's skills based on target roles, experience level, and resume summary. Sign off professionally.",
  "whatsAppMsg": "Write a warm, concise outreach message for WhatsApp (max 100 words) introducing the candidate and expressing interest. Make it sound human."
}`;

  try {
    const raw = await gemini(prompt);
    const clean = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);
    return parsed;
  } catch (err) {
    console.error('Failed to generate outreach via Gemini:', err);
    return {
      emailSubject: `Application for ${job.title} at ${job.company}`,
      emailBody: `Hi Hiring Team,\n\nI am writing to express my interest in the ${job.title} position at ${job.company}.\n\nBest regards,\n${profile.userName}`,
      whatsAppMsg: `Hi! I'm interested in the ${job.title} position at ${job.company}. Would love to connect!`
    };
  }
};

const applyToJobsForUser = async (userId) => {
  try {
    const profile = await JobProfile.findOne({ userId });
    if (!profile) {
      console.log(`No JobProfile found for user ${userId}, skipping application.`);
      return 0;
    }

    const jobsToApply = await Job.find({ userId, status: 'to-apply' }).limit(2);
    if (jobsToApply.length === 0) {
      console.log(`No 'to-apply' jobs found for user ${userId}.`);
      return 0;
    }

    let appliedCount = 0;
    const wsStatus = getStatus().status;

    for (const job of jobsToApply) {
      // If contact details are missing and we have a url, run deep crawl scraper (up to 20 pages)
      if (job.url && (!job.contactEmail && !job.contactNumber)) {
        try {
          console.log(`[Cron] Missing contact details for ${job.title} at ${job.company}. Running deep crawl scraper...`);
          const crawlResult = await crawlAndExtractContacts(job.url);
          
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
        } catch (err) {
          console.warn('[Cron] Failed to deeply scrape contact details:', err.message);
        }
      }

      // If we STILL don't have email or phone number after deep crawling, move to manual-review
      if (!job.contactEmail && !job.contactNumber) {
        job.status = 'manual-review';
        await job.save();
        console.log(`[Cron] Job ${job.title} at ${job.company} moved to manual-review (no contacts found).`);
        continue;
      }

      // Find best resume matches if resumes bank is populated
      let selectedResume = null;
      if (profile.resumes && profile.resumes.length > 0) {
        selectedResume = await selectBestResume(profile.resumes, job);
      }

      const outreach = await generateOutreach(profile, job, selectedResume);
      
      job.aiWhatsAppMsg = outreach.whatsAppMsg;
      job.aiEmailSubject = outreach.emailSubject;
      job.aiEmailBody = outreach.emailBody;
      job.status = 'applied';
      job.appliedAt = new Date();

      if (selectedResume) {
        job.appliedResumeId = selectedResume._id;
        job.appliedResumeName = selectedResume.name;
      }

      const phones = job.contactNumbers && job.contactNumbers.length > 0 ? job.contactNumbers : (job.contactNumber ? [job.contactNumber] : []);
      if (wsStatus === 'connected' && phones.length > 0) {
        for (const phone of phones) {
          try {
            await sendWhatsAppMessage(phone, outreach.whatsAppMsg);
            console.log(`Automated WhatsApp sent to ${phone} for job: ${job.title}`);
          } catch (wsErr) {
            console.error(`Failed to send automated WhatsApp to ${phone}:`, wsErr.message);
          }
        }
      }

      await job.save();
      appliedCount++;
    }

    return appliedCount;
  } catch (err) {
    console.error(`Error in applyToJobsForUser for ${userId}:`, err);
    throw err;
  }
};

// ── Automated Exa Searcher ───────────────────────────────────────────────────
const runAutomatedSearch = async (userId, query) => {
  try {
    const profile = await JobProfile.findOne({ userId });
    const key = profile?.exaApiKey || process.env.EXA_API_KEY;
    if (!key) {
      console.warn(`No Exa API key for user ${userId}, auto-search skipped.`);
      return;
    }

    let exaClient;
    const Exa = require('exa-js');
    if (typeof Exa === 'function') {
      exaClient = new Exa(key);
    } else if (Exa.default && typeof Exa.default === 'function') {
      exaClient = new Exa.default(key);
    } else if (typeof Exa.default === 'object') {
      exaClient = new Exa.default(key);
    }

    if (!exaClient) return;

    const searchQuery = `${query} job openings career page`;
    const searchRes = await exaClient.search(searchQuery, {
      type: 'auto',
      numResults: 5,
      contents: { highlights: true }
    });

    const results = searchRes.results || [];
    let imported = 0;
    const wsStatus = getStatus().status;

    for (const res of results) {
      const exists = await Job.exists({ userId, url: res.url });
      if (!exists) {
        const companyName = res.url.replace(/https?:\/\/(www\.)?/, '').split('.')[0];
        const job = new Job({
          userId,
          title: res.title || 'Software Developer',
          company: companyName,
          url: res.url,
          description: res.highlights?.join('\n') || '',
          status: 'to-apply'
        });

        // Try deep crawl to find contact details immediately
        try {
          console.log(`[AutoSearch] Crawling contacts for newly found job: ${job.url}`);
          const crawlResult = await crawlAndExtractContacts(job.url);
          
          job.contactEmails = crawlResult.emails || [];
          if (job.contactEmails.length > 0) {
            job.contactEmail = job.contactEmails[0];
          }

          job.contactNumbers = crawlResult.phones || [];
          if (job.contactNumbers.length > 0) {
            job.contactNumber = job.contactNumbers[0];
          }
        } catch (err) {
          console.error(`[AutoSearch] Crawl failed for ${job.url}:`, err.message);
        }

        // Check if we found contacts
        if (job.contactEmail || job.contactNumber) {
          // Contacts found! Let's auto-apply
          try {
            let selectedResume = null;
            if (profile.resumes && profile.resumes.length > 0) {
              selectedResume = await selectBestResume(profile.resumes, job);
            }

            const outreach = await generateOutreach(profile, job, selectedResume);
            job.aiWhatsAppMsg = outreach.whatsAppMsg;
            job.aiEmailSubject = outreach.emailSubject;
            job.aiEmailBody = outreach.emailBody;
            job.status = 'applied';
            job.appliedAt = new Date();

            if (selectedResume) {
              job.appliedResumeId = selectedResume._id;
              job.appliedResumeName = selectedResume.name;
            }

            // Send WhatsApp if connected
            const phones = job.contactNumbers && job.contactNumbers.length > 0 ? job.contactNumbers : (job.contactNumber ? [job.contactNumber] : []);
            if (wsStatus === 'connected' && phones.length > 0) {
              for (const phone of phones) {
                try {
                  await sendWhatsAppMessage(phone, outreach.whatsAppMsg);
                  console.log(`[AutoSearch] WhatsApp sent to ${phone} for job: ${job.title}`);
                } catch (wsErr) {
                  console.error(`[AutoSearch] Failed to send WhatsApp to ${phone}:`, wsErr.message);
                }
              }
            }
          } catch (applyErr) {
            console.error(`[AutoSearch] Failed to auto-apply for ${job.title}:`, applyErr.message);
            // Fallback: leave as to-apply
            job.status = 'to-apply';
          }
        } else {
          // No contact details found even after deep crawl -> manual section
          job.status = 'manual-review';
          console.log(`[AutoSearch] No contacts found for ${job.title}. Moved to manual-review.`);
        }

        await job.save();
        imported++;
      }
    }
    console.log(`Auto-search complete for user ${userId}. Imported ${imported} new jobs.`);
  } catch (err) {
    console.error(`Error in runAutomatedSearch for user ${userId}:`, err.message);
  }
};

// ── Cron Scheduler Initialization ────────────────────────────────────────────
const startCron = () => {
  // 1. Standard daily apply cron at 8:00 AM (remains active as default)
  cron.schedule('0 8 * * *', async () => {
    console.log('Running daily Job Application Cron at 8:00 AM...');
    try {
      const profiles = await JobProfile.find({});
      for (const profile of profiles) {
        const count = await applyToJobsForUser(profile.userId);
        console.log(`Cron applied to ${count} jobs for user ${profile.userId}`);
      }
    } catch (err) {
      console.error('Error in daily job application cron:', err);
    }
  }, {
    timezone: 'Asia/Kolkata'
  });

  // 2. Custom minute-by-minute checker for user-scheduled tasks
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    // Format current time as "HH:MM" (Kolkata timezone)
    const timeStr = now.toLocaleTimeString('en-US', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });

    try {
      const activeTasks = await AutomatedTask.find({
        isActive: true,
        time: timeStr
      });

      for (const task of activeTasks) {
        console.log(`[Scheduler] Triggering task ${task.type} (${task.time}) for user ${task.userId}`);
        if (task.type === 'apply') {
          await applyToJobsForUser(task.userId);
        } else if (task.type === 'message' && task.data?.phone && task.data?.messageText) {
          const wsStatus = getStatus().status;
          if (wsStatus === 'connected') {
            await sendWhatsAppMessage(task.data.phone, task.data.messageText);
          } else {
            console.warn(`[Scheduler] WhatsApp not connected, message to ${task.data.phone} skipped.`);
          }
        } else if (task.type === 'search' && task.data?.query) {
          await runAutomatedSearch(task.userId, task.data.query);
        }
      }
    } catch (err) {
      console.error('Error in automated custom task checker cron:', err);
    }
  });

  console.log('Job application scheduler initialized (Minute-by-minute active)');
};

module.exports = {
  startCron,
  applyToJobsForUser,
  selectBestResume,
  generateOutreach,
  gemini,
  runAutomatedSearch,
  fetchHtmlContent,
  cleanHtml,
  extractContactDetailsWithRegex,
  crawlAndExtractContacts
};
