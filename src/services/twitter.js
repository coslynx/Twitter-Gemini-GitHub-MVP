const puppeteer = require("puppeteer");
const config = require("../../config");
const { Tweet } = require("../utils/dbConnection");
const { logger, sleep } = require("../utils/helpers");

class TwitterService {
  constructor() {
    this.browser = null;
    this.page = null;

    this.searchQueriesType1 = [
      "ai tools thread 🧵",
      "artificial intelligence news thread",
      "chatgpt tips thread",
      "ai automation guide 🧵",
      "machine learning tools thread",
      "ai productivity tools 🧵",
      "filter:links new ai tools",
      "ai developments thread",
      "generative ai guide 1/",
      "ai models comparison (1/",
      "ai research findings thread",
      "llm developments 🧵",
      "ai tools comparison thread",
      "future of ai thread",
    ];
    this.searchQueriesType2 = [
      "coding best practices 🧵",
      "software architecture thread",
      "developer tools guide",
      "programming tips 🧵",
      "backend development thread",
      "frontend frameworks 🧵",
      "filter:links coding resources",
      "system design tips thread",
      "database optimization 1/",
      "clean code guide 🧵",
      "web development tools thread",
      "devops practices 🧵",
      "coding patterns thread",
      "microservices guide thread",
    ];
    this.searchQueriesType3 = [
      "passive income guide 🧵",
      "productivity system thread",
      "digital tools thread",
      "work optimization 🧵",
      "side business guide thread",
      "freelancing success 🧵",
      "filter:links productivity stack",
      "remote work tools thread",
      "business automation 1/",
      "digital nomad guide 🧵",
      "online business thread",
      "time management system 🧵",
      "wealth building guide thread",
      "personal finance tips 🧵",
    ];

    this.currentQueryIndex = 0;
    this.currentTypeIndex = 0;
    this.lastUsedType = null;

    this.searchFilters = ["&f=top", "&f=live"];
  }

  getSearchQuery() {
    const types = [
      this.searchQueriesType1,
      this.searchQueriesType2,
      this.searchQueriesType3,
    ];

    this.currentTypeIndex = Math.floor(Math.random() * types.length);

    const selectedType = types[this.currentTypeIndex];

    this.currentQueryIndex = Math.floor(Math.random() * selectedType.length);

    const selectedQuery = selectedType[this.currentQueryIndex];

    this.lastUsedType = this.currentTypeIndex + 1;

    const filter = Math.random() < 0.5 ? "&f=top" : "&f=live";

    return selectedQuery + filter;
  }

  async init() {
    try {
      if (!this.browser) {
        this.browser = await puppeteer.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--window-size=1280,720",
            "--disable-notifications",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--disable-canvas-aa",
            "--disable-2d-canvas-clip-aa",
            "--disable-gl-drawing-for-tests",
            "--no-first-run",
            "--no-zygote",
            "--single-process",
            "--disable-dev-shm-usage",
            "--disable-infobars",
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-breakpad",
            "--disable-component-extensions-with-background-pages",
            "--disable-extensions",
            "--disable-features=TranslateUI",
            "--disable-ipc-flooding-protection",
            "--disable-renderer-backgrounding",
            "--enable-features=NetworkService,NetworkServiceInProcess",
            "--force-color-profile=srgb",
            "--metrics-recording-only",
            "--mute-audio",
            "--js-flags=--max-old-space-size=4096",
          ],
          defaultViewport: {
            width: 1280,
            height: 720,
          },
          protocolTimeout: 180000,
          timeout: 180000,
          ignoreHTTPSErrors: true,
        });
      }

      if (!this.page) {
        this.page = await this.browser.newPage();
        this.page.setDefaultNavigationTimeout(180000);
        this.page.setDefaultTimeout(180000);

        await this.page.setCacheEnabled(false);

        await this.page.setRequestInterception(true);
        this.page.on("request", (request) => {
          if (
            request.resourceType() === "image" ||
            request.resourceType() === "stylesheet" ||
            request.resourceType() === "font"
          ) {
            request.abort();
          } else {
            request.continue();
          }
        });
      }
    } catch (error) {
      logger.error("Failed to initialize:", error);
      await this.cleanup();
      throw error;
    }
  }

  async findContent() {
    try {
      const THREADS_NEEDED = 10;
      const MAX_SCROLL_ATTEMPTS = 1500;
      const SCROLL_PAUSE = 3000;
      const MAX_NO_NEW_TWEETS = 10;
      const INITIAL_LOAD_TIMEOUT = 10000;

      let collectedContent = [];
      let scrollAttempts = 0;
      let processedTweetIds = new Set();
      let lastHeight = 0;
      let noNewTweetsCount = 0;

      try {
        await this.page.waitForSelector('article[data-testid="tweet"]', {
          timeout: INITIAL_LOAD_TIMEOUT,
        });
      } catch (error) {
        logger.warn("No tweets found on initial load, retrying scroll...");
      }

      while (
        scrollAttempts < MAX_SCROLL_ATTEMPTS &&
        collectedContent.length < THREADS_NEEDED
      ) {
        logger.info(
          `Scroll attempt ${scrollAttempts + 1}/${MAX_SCROLL_ATTEMPTS}, found ${
            collectedContent.length
          }/${THREADS_NEEDED} content pieces`
        );

        await this.page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
        });
        await sleep(SCROLL_PAUSE);

        const currentHeight = await this.page.evaluate(
          "document.documentElement.scrollHeight"
        );

        const potentialContent = await this.page.evaluate(() => {
          const tweets = Array.from(
            document.querySelectorAll('article[data-testid="tweet"]')
          );
          return tweets
            .map((tweet) => {
              try {
                const tweetText = tweet
                  .querySelector('[data-testid="tweetText"]')
                  ?.innerText?.trim();
                if (!tweetText || tweetText.length < 50) return null;

                const tweetUrl = tweet.querySelector(
                  'a[href*="/status/"]'
                )?.href;
                if (!tweetUrl) return null;

                const links = Array.from(
                  tweet.querySelectorAll('a[href*="http"]')
                )
                  .map((a) => a.href)
                  .filter((href) => !href.includes("twitter.com"));

                const images = Array.from(
                  tweet.querySelectorAll('img[src*="https"]')
                )
                  .map((img) => img.src)
                  .filter(
                    (src) => !src.includes("emoji") && !src.includes("profile")
                  );

                return {
                  tweets: [
                    {
                      text: tweetText,
                      images: images,
                      links: links,
                    },
                  ],
                  url: tweetUrl,
                  timestamp: tweet
                    .querySelector("time")
                    ?.getAttribute("datetime"),
                };
              } catch (error) {
                console.error(`Error processing tweet: ${error.message}`);
                return null;
              }
            })
            .filter(Boolean);
        });

        if (potentialContent.length > 0) {
          noNewTweetsCount = 0;
        } else {
          noNewTweetsCount++;
          if (noNewTweetsCount >= MAX_NO_NEW_TWEETS) {
            logger.info(
              "No new tweets found after multiple attempts, trying page refresh..."
            );
            await this.page.reload({ waitUntil: "networkidle0" });
            noNewTweetsCount = 0;
            continue;
          }
        }

        for (const content of potentialContent) {
          if (collectedContent.length >= THREADS_NEEDED) break;

          const tweetId = content.url.split("/status/")[1]?.split("?")[0];
          if (!tweetId || processedTweetIds.has(tweetId)) continue;

          processedTweetIds.add(tweetId);
          try {
            const existingTweet = await Tweet.findOne({ id: tweetId });
            if (!existingTweet) {
              logger.info(`Processing: ${content.url}`);
              collectedContent.push(content);
            } else {
              logger.debug(`Skipping existing tweet: ${content.url}`);
            }
          } catch (dbError) {
            if (dbError.code !== 11000) {
              logger.error(
                `Database operation failed for ${content.url}:`,
                dbError
              );
            }
            continue;
          }
        }

        if (currentHeight === lastHeight) {
          noNewTweetsCount++;
        } else {
          lastHeight = currentHeight;
        }

        scrollAttempts++;
      }

      return collectedContent;
    } catch (error) {
      logger.error("Error in findContent:", error);
      return [];
    }
  }

  async login() {
    try {
      logger.info("Starting login process...");
      await this.page.goto("https://twitter.com/i/flow/login", {
        waitUntil: "networkidle0",
        timeout: 60000,
      });

      logger.info("Waiting for username field...");
      await this.page.waitForSelector('input[autocomplete="username"]', {
        visible: true,
        timeout: 60000,
      });
      await sleep(2000);
      await this.page.type(
        'input[autocomplete="username"]',
        config.twitter.username,
        {
          delay: 100,
        }
      );
      logger.info("Username entered");
      await sleep(2000);
      await this.page.keyboard.press("Enter");
      await sleep(3000);

      logger.info("Checking for email verification...");
      const emailRequired = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const emailInput = inputs.find(
          (input) =>
            input.type === "text" ||
            input.type === "email" ||
            input.name === "text" ||
            input.name === "email" ||
            (input.placeholder &&
              input.placeholder.toLowerCase().includes("email"))
        );
        return {
          required: !!emailInput,
          type: emailInput?.type || "",
          placeholder: emailInput?.placeholder || "",
        };
      });

      if (emailRequired.required) {
        logger.info("Email verification required");

        if (!config.twitter.email) {
          throw new Error("Email verification required but not configured");
        }

        const emailSelectors = [
          'input[type="text"]',
          'input[type="email"]',
          'input[name="text"]',
          'input[name="email"]',
        ];

        let inputFound = false;
        for (const selector of emailSelectors) {
          try {
            const input = await this.page.$(selector);
            if (input) {
              await input.type(config.twitter.email, { delay: 100 });
              inputFound = true;
              logger.info(`Email entered using selector: ${selector}`);
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!inputFound) {
          throw new Error("Could not find email input field");
        }

        await sleep(2000);

        await this.page.keyboard.press("Enter");

        await sleep(5000);
      }

      logger.info("Looking for password field...");

      const passwordFieldFound = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const passwordInput = inputs.find(
          (input) =>
            input.type === "password" ||
            input.name === "password" ||
            input.autocomplete === "current-password" ||
            input.placeholder?.toLowerCase().includes("password")
        );
        if (passwordInput) {
          passwordInput.focus();
          return true;
        }
        return false;
      });

      if (!passwordFieldFound) {
        await this.page.screenshot({
          path: "debug-password-not-found.png",
          fullPage: true,
        });
        throw new Error("Could not find password field");
      }

      logger.info("Password field found, entering password");
      await sleep(1000);
      await this.page.keyboard.type(config.twitter.password, { delay: 100 });
      await sleep(2000);
      await this.page.keyboard.press("Enter");
      await sleep(5000);

      const loginSuccess = await this.page.evaluate(() => {
        return !document.querySelector('input[name="password"]');
      });

      if (!loginSuccess) {
        throw new Error("Login failed - password field still present");
      }

      logger.info("Login successful");
    } catch (error) {
      logger.error("Login failed:", error);

      await this.page.screenshot({ path: "login-error.png", fullPage: true });
      throw error;
    }
  }

  async fetchTweets(options = {}) {
    const {
      maxRetries = 3,
      retryDelay = 5000,
      reinitializeOnFailure = true,
    } = options;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.page) {
          await this.init();
          await this.login();
        }

        const searchQuery = this.getSearchQuery();
        logger.info(
          `Processing search query: ${searchQuery} (Type: ${this.lastUsedType})`
        );

        const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(
          searchQuery
        )}`;

        await this.page.goto(searchUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });

        const content = await this.findContent();

        return {
          threads: content,
          queryType: this.lastUsedType,
          searchQuery: searchQuery,
        };
      } catch (error) {
        logger.error(`Fetch attempt ${attempt} failed:`, error);

        if (attempt === maxRetries) {
          if (reinitializeOnFailure) {
            logger.warn("Max retries reached. Reinitializing browser.");
            await this.close();
            await this.init();
          }
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  async cleanup() {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }
    } catch (error) {
      logger.error("Cleanup failed:", error);
    }
  }
}

module.exports = new TwitterService();
