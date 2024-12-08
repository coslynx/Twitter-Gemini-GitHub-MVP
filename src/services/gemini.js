const {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} = require("@google/generative-ai");
const config = require("../../config");
const { logger } = require("../utils/helpers");

class GeminiService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.safetySettings = [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ];
    this.systemPrompt = `
You are a professional content curator and markdown writer. Transform Twitter threads and their resources into engaging markdown articles that MUST follow this exact format:


### 🔗 {Clear Resource Category Title}

{Brief introduction about this collection of resources from the thread}

Featured Resources:
{Numbered list of resources with descriptions from the thread context}

Key Highlights:

• {Main benefit or feature from thread context 1}

• {Main benefit or feature from thread context 2}

• {Main benefit or feature from thread context 3}

💡 Pro Tips:
{Practical implementation advice derived from the thread}

🔗 Resources:
• {All external links from the thread with descriptive titles}

---

Important rules:
1. Always include section separators (---)
2. Always start with H3 header (###) and emoji
3. Always format links as [descriptive title](url)
4. Always include the original context from the thread
5. Always maintain professional tone
6. Group related resources together coherently
7. Keep descriptions clear and concise
8. Never skip any sections
9. Never add fake links or resources
10. Always include ALL external links from the thread

Note:
1. Always include the original context from the thread
2. If no resources are provided, do not include the Resources section
3. Always embed images and links from the thread with correct descriptions
4. Fill it with your best knowledge of the topic, if not enough context is provided.
5. When alot of context is missing, write a detailed introduction about the topic and provide links to more information.
`;
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.8,
        maxOutputTokens: 100000,
      },
      safetySettings: this.safetySettings,
      systemInstruction: this.systemPrompt,
    });
  }

  async generateChat() {
    try {
      return this.model.startChat({
        history: [
          {
            role: "user",
            parts: [this.systemPrompt],
          },
          {
            role: "model",
            parts: ["I will strictly follow the markdown format provided."],
          },
        ],
      });
    } catch (error) {
      logger.error("Error creating Gemini chat:", error);
      throw new Error("Failed to initialize Gemini chat");
    }
  }

  async generateMarkdown(threads) {
    try {
      let allMarkdown = "";

      const exampleFormat = `
      Example of perfect formatting:
      
      ---
      ### 🤖 Observability, Evaluation, and RAG Implementation
      
      This article outlines the differences between analytics and observability, explains the components needed for a Retrieval Augmented Generation (RAG) system, and provides implementation guidance.
      
      Key Points:
      • Analytics provides high-level metrics like user counts and page views.

      • Observability offers deeper insights into individual user requests and responses.
      
      • A basic RAG system requires an inference provider and a vector database.
      

      🚀 Implementation:
      1. Choose an Inference Provider: Select a service that provides the necessary AI model.
      2. Select a Vector Database: Choose a database suitable for storing embeddings.
      3. Develop Retrieval Logic: Implement logic to retrieve relevant information.
      
      🔗 Resources:
      • [Tool Name](https://example.com) - Brief description of the tool.

      • [Another Tool](https://example.com) - What this tool helps with.
      `;

      for (const thread of threads) {
        if (!thread.tweets || thread.tweets.length === 0) {
          logger.warn("Skipping thread with no tweets");
          continue;
        }

        const tweetContent = thread.tweets
          .map((tweet) => {
            let content = tweet.text || "";

            if (tweet.images && tweet.images.length > 0) {
              content +=
                "\n\n" +
                tweet.images.map((img) => `![Image](${img})`).join("\n");
            }

            return content;
          })
          .join("\n\n");

        const links = [
          ...new Set(
            thread.tweets.flatMap((tweet) => tweet.links || []).filter(Boolean)
          ),
        ];

        const prompt = `
You are a professional technical content curator. Transform this Twitter thread into a high-quality markdown article following these EXACT specifications:

FORMAT REQUIREMENTS:
1. HEADER (MANDATORY):
   - Start with "### " followed by ONE emoji and title
   - Emoji options: 🤖 for technical, 🚀 for tools, 💡 for tips, ✨ for features
   - Title format: "### [emoji] Main Topic - Subtopic"
   - Example: "### 🤖 Observability - RAG Implementation"

2. INTRODUCTION (MANDATORY):
   - 2-3 sentences maximum
   - Explain what the article covers
   - No marketing language
   - Professional tone
   - No emojis in introduction

3. KEY POINTS (MANDATORY):
   - Start with "Key Points:"
   - Add TWO newlines after "Key Points:"
   - Use bullet points with "•" symbol
   - 3-5 points maximum
   - Each point must be separated by TWO newlines
   - Each point: single line, clear benefit
   - No emojis in points
   - Example:
     Key Points:
     • First key point about the topic

     • Second key point about functionality

     • Third key point about benefits

     • Fourth key point describing main feature

     • Fifth key point highlighting unique value

   SPACING RULES FOR POINTS:
   - Double newline after section header
   - Double newline between each bullet point
   - Double newline after last bullet point
   - Example format:
     Key Points:  
     • Point one
   
     • Point two
   
     • Point three

4. IMPLEMENTATION (IF APPLICABLE):
   - Start with "🚀 Implementation:"
   - Numbered steps (1. 2. 3. etc)
   - 3-5 steps maximum
   - Each step: action-oriented, clear
   - Example:
     🚀 Implementation:
     1. First Step: What to do first
     2. Second Step: What to do next
     3. Third Step: Final action

5. RESOURCES (MANDATORY):
   - Start with "🔗 Resources:"
   - Format: • [Tool Name](url) - Brief description
   - Description: max 10 words
   - Only include verified links
   - Example:
     🔗 Resources:
     • [Tool Name](https://example.com) - What this tool helps with

     • [Another Tool](https://example.com) - What this tool helps with

     • [Third Tool](https://example.com) - What this tool helps with

STRICT FORMATTING RULES:
- Maintain exact spacing shown in example
- No bold or italic text
- No extra emojis
- No extra sections
- No marketing language
- No placeholder content
- No "Learn more" or similar phrases
- No colons in descriptions
- No extra horizontal rules

Here's the content to transform:
${tweetContent}

Here's the example format:
${exampleFormat}

${links.length > 0 ? `\nRelevant Links:\n${links.join("\n")}` : ""}

Remember:
1. Keep it professional and technical
2. Follow exact spacing and formatting
3. No deviations from the structure
4. No extra decorative elements
5. Verify all links before including

Note:
1. Always include the original context from the thread
2. If no resources are provided, do not include the Resources section
3. Always embed images and links from the thread with correct descriptions
4. Fill it with your best knowledge of the topic, if not enough context is provided.
5. When alot of context is missing, write a detailed introduction about the topic and provide links to more information.`;

        try {
          const result = await this.model.generateContent(prompt);
          let generatedText = result.response.text();

          generatedText = generatedText
            .replace(
              /!\[\]\((https?:\/\/[^\s)]+)\)/g,
              "![Image Description Here]($1)"
            )

            .replace(
              /\[(https?:\/\/[^\s\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
              "[Resource Link]($2)"
            );

          generatedText = generatedText
            .replace(/```markdown/g, "")
            .replace(/```/g, "")
            .trim();

          generatedText = generatedText.replace(/^---\s*\n/, "");

          if (
            !generatedText ||
            !generatedText.match(/^### [🔗🚀⚡️💡🔨🛠️🤖✨🌟🔥]/)
          ) {
            logger.warn("Invalid content format, skipping...");
            continue;
          }

          const sections = generatedText
            .split(/\n---\n/)
            .map((section) => section.trim())
            .filter((section) => {
              return (
                section.match(/^### [🔗🚀⚡️💡🔨🛠️🤖✨🌟🔥]/) &&
                section.length > 10
              );
            });

          if (sections.length === 0) {
            logger.warn("No valid sections found after cleanup");
            continue;
          }

          generatedText = sections.join("\n\n---\n\n").trim();

          if (allMarkdown) {
            allMarkdown += "\n\n---\n\n";
          }
          allMarkdown += generatedText;
        } catch (error) {
          logger.error("Failed to generate content for thread:", error);
          continue;
        }
      }

      if (!allMarkdown.trim()) {
        throw new Error("No markdown content was generated");
      }

      const supportSection = `
---

### ⭐️ Support & Contributions

If you enjoy this repository, please star ⭐️ it and follow [Drix10](https://github.com/Drix10) to help others discover these resources. Contributions are always welcome! Submit pull requests with additional links, tips, or any useful resources that fit these categories.

---`;

      return (
        allMarkdown.replace(/\n---\n\s*$/g, "").trim() + "\n\n" + supportSection
      );
    } catch (error) {
      logger.error("Error in markdown generation:", error);
      throw error;
    }
  }

  groupTweetsByConversation(tweets) {
    const conversations = new Map();

    tweets.forEach((tweet) => {
      const conversationId = tweet.conversation_id || tweet.id;
      if (!conversations.has(conversationId)) {
        conversations.set(conversationId, []);
      }
      conversations.get(conversationId).push(tweet);
    });

    return Array.from(conversations.values());
  }
}

module.exports = new GeminiService();
