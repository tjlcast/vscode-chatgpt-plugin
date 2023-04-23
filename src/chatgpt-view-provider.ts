/* eslint-disable eqeqeq */
/* eslint-disable @typescript-eslint/naming-convention */
import delay from 'delay';
import fetch from 'isomorphic-fetch';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { ChatGPTAPI as ChatGPTAPI3 } from '../chatgpt-4.7.2/index';
import { ChatGPTAPI as ChatGPTAPI35 } from '../chatgpt-5.1.1/index';
import { AuthType, LeftOverMessage, LoginMethod, MessageOption } from './types';
export default class ChatgptViewProvider implements vscode.WebviewViewProvider {
  private webView?: vscode.WebviewView;

  public subscribeToResponse: boolean;
  public autoScroll: boolean;
  public useAutoLogin?: boolean;
  public useGpt3?: boolean;
  public chromiumPath?: string;
  public profilePath?: string;
  public model?: string;

  private apiGpt3?: ChatGPTAPI3;
  private apiGpt35?: ChatGPTAPI35;
  private conversationId?: string;
  private messageId?: string;
  private proxyServer?: string;
  private loginMethod?: LoginMethod;
  private authType?: AuthType;
  // 问题数量
  private questionCounter: number = 0;
  private inProgress: boolean = false;
  private abortController?: AbortController;
  private currentMessageId: string = '';
  private response: string = '';

  private leftOverMessage?: LeftOverMessage;
  /**
   * 如果消息没有被渲染，则延迟渲染
   * 在调用 resolveWebviewView 之前的时间。
   */
  constructor(private context: vscode.ExtensionContext) {
    this.subscribeToResponse =
      vscode.workspace.getConfiguration('chatgpt').get('response.showNotification') || false;
    this.autoScroll = !!vscode.workspace.getConfiguration('chatgpt').get('response.autoScroll');
    this.model = vscode.workspace.getConfiguration('chatgpt').get('gpt3.model');

    this.setMethod();
    this.setChromeExecutablePath();
    this.setProfilePath();
    this.setProxyServer();
    this.setAuthType();
  }
  /**
   * @desc 加载webview
   * @param {vscode.WebviewView} webviewView
   * @param {vscode.WebviewViewResolveContext} _context
   * @param {vscode.CancellationToken} _token
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.webView = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,

      localResourceRoots: [this.context.extensionUri],
    };
    // 设置webview的html内容
    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);
    // webviewView.webview.html = this.getWebviewHtml("./media/web-view.html");

    // 在监听器内部根据消息命令类型执行不同的操作。
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        // 从webview中获取到用户输入的问题，然后调用sendApiRequest方法发送给后端。
        case 'addFreeTextQuestion':
          this.sendApiRequest(data.value, { command: 'freeText' });
          break;
        case 'editCode':
          const escapedString = (data.value as string).replace(/\$/g, '\\$');
          vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(escapedString));

          this.logEvent('code-inserted');
          break;
        case 'openNew':
          // 打开新的文件
          const document = await vscode.workspace.openTextDocument({
            content: data.value,
            language: data.language,
          });
          vscode.window.showTextDocument(document);

          this.logEvent(data.language === 'markdown' ? 'code-exported' : 'code-opened');
          break;

        case 'clearConversation':
          // 清空会话
          this.messageId = undefined;
          this.conversationId = undefined;
          this.logEvent('conversation-cleared');
          break;
        case 'clearBrowser':
          this.logEvent('browser-cleared');
          break;
        case 'cleargpt3':
          this.apiGpt3 = undefined;

          this.logEvent('gpt3-cleared');
          break;
        case 'login':
          this.prepareConversation().then((success) => {
            if (success) {
              this.sendMessage(
                { type: 'loginSuccessful', showConversations: this.useAutoLogin },
                true,
              );

              this.logEvent('logged-in');
            }
          });
          break;
        case 'openSettings':
          // 打开设置
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:YOUR_PUBLISHER_NAME.vscode-chatgpt chatgpt.',
          );

          this.logEvent('settings-opened');
          break;
        case 'openSettingsPrompt':
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:YOUR_PUBLISHER_NAME.vscode-chatgpt promptPrefix',
          );

          this.logEvent('settings-prompt-opened');
          break;
        case 'listConversations':
          this.logEvent('conversations-list-attempted');
          break;
        case 'showConversation':
          /// ...
          break;
        case 'stopGenerating':
          // 停止生成代码
          this.stopGenerating();
          break;
        default:
          break;
      }
    });

    if (this.leftOverMessage !== null) {
      // If there were any messages that wasn't delivered, render after resolveWebView is called.
      this.sendMessage(this.leftOverMessage as MessageOption);
      this.leftOverMessage = null;
    }
  }

  private stopGenerating(): void {
    this.abortController?.abort?.();
    this.inProgress = false;
    this.sendMessage({ type: 'showInProgress', inProgress: this.inProgress });
    const responseInMarkdown = !this.isCodexModel;
    this.sendMessage({
      type: 'addAnswer',
      value: this.response,
      done: true,
      id: this.currentMessageId,
      autoScroll: this.autoScroll,
      responseInMarkdown,
    });
    this.logEvent('stopped-generating');
  }

  public clearSession(): void {
    this.stopGenerating();
    this.apiGpt3 = undefined;
    this.messageId = undefined;
    this.conversationId = undefined;
    this.logEvent('cleared-session');
  }
  /**
   * @desc 设置代理服务器
   */
  public setProxyServer(): void {
    this.proxyServer = vscode.workspace.getConfiguration('chatgpt').get('proxyServer');
  }

  public setMethod(): void {
    this.loginMethod = vscode.workspace.getConfiguration('chatgpt').get('method') as LoginMethod;
    this.useGpt3 = true;
    this.useAutoLogin = false;
    this.clearSession();
  }

  public setAuthType(): void {
    this.authType = vscode.workspace.getConfiguration('chatgpt').get('authenticationType');
    this.clearSession();
  }

  public setChromeExecutablePath(): void {
    let path = '';
    switch (os.platform()) {
      case 'win32':
        path = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        break;

      case 'darwin':
        path = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        break;

      default:
        const chromeExists = fs.existsSync('/usr/bin/google-chrome');

        path = chromeExists ? '/usr/bin/google-chrome' : '/usr/bin/google-chrome-stable';
        break;
    }

    this.chromiumPath = vscode.workspace.getConfiguration('chatgpt').get('chromiumPath') || path;
    this.clearSession();
  }

  public setProfilePath(): void {
    this.profilePath = vscode.workspace.getConfiguration('chatgpt').get('profilePath');
    this.clearSession();
  }

  private get isCodexModel(): boolean {
    return !!this.model?.startsWith('code-');
  }

  private get isGpt35Model(): boolean {
    return !!this.model?.startsWith('gpt-');
  }

  public async prepareConversation(modelChanged = false): Promise<boolean> {
    if (modelChanged && this.useAutoLogin) {
      // no need to reinitialize in autologin when model changes
      return false;
    }

    const state = this.context.globalState;
    const configuration = vscode.workspace.getConfiguration('chatgpt');

    if (this.useGpt3) {
      if (
        (this.isGpt35Model && !this.apiGpt35) ||
        (!this.isGpt35Model && !this.apiGpt3) ||
        modelChanged
      ) {
        let apiKey =
          (configuration.get('gpt3.apiKey') as string) ||
          (state.get('chatgpt-gpt3-apiKey') as string);

        const organization = configuration.get('gpt3.organization') as string;
        // 获取 openai maxTokens 配置
        const max_tokens = configuration.get('gpt3.maxTokens') as number;
        const temperature = configuration.get('gpt3.temperature') as number;
        const top_p = configuration.get('gpt3.top_p') as number;
        const apiBaseUrl = configuration.get('gpt3.apiBaseUrl') as string;

        if (!apiKey) {
          vscode.window
            .showErrorMessage(
              'Please add your API Key to use OpenAI official APIs. Storing the API Key in Settings is discouraged due to security reasons, though you can still opt-in to use it to persist it in settings. Instead you can also temporarily set the API Key one-time: You will need to re-enter after restarting the vs-code.',
              'Store in session (Recommended)',
              'Open settings',
            )
            .then(async (choice) => {
              if (choice === 'Open settings') {
                vscode.commands.executeCommand(
                  'workbench.action.openSettings',
                  'chatgpt.gpt3.apiKey',
                );
                return false;
              } else if (choice === 'Store in session (Recommended)') {
                await vscode.window
                  .showInputBox({
                    title: 'Store OpenAI API Key in session',
                    prompt:
                      "Please enter your OpenAI API Key to store in your session only. This option won't persist the token on your settings.json file. You may need to re-enter after restarting your VS-Code",
                    ignoreFocusOut: true,
                    placeHolder: 'API Key',
                    value: apiKey || '',
                  })
                  .then((value) => {
                    if (value) {
                      apiKey = value;
                      state.update('chatgpt-gpt3-apiKey', apiKey);
                      this.sendMessage(
                        { type: 'loginSuccessful', showConversations: this.useAutoLogin },
                        true,
                      );
                    }
                  });
              }
            });

          return false;
        }
        // 初始化 chatgpt 模型
        if (this.isGpt35Model) {
          this.apiGpt35 = new ChatGPTAPI35({
            apiKey,
            fetch: fetch,
            apiBaseUrl: apiBaseUrl?.trim() || undefined,
            organization,
            completionParams: {
              model: this.model,
              max_tokens,
              temperature,
              top_p,
            },
          });
        } else {
          this.apiGpt3 = new ChatGPTAPI3({
            apiKey,
            fetch: fetch,
            apiBaseUrl: apiBaseUrl?.trim() || undefined,
            organization,
            completionParams: {
              model: this.model,
              max_tokens,
              temperature,
              top_p,
            },
          });
        }
      }
    }

    this.sendMessage({ type: 'loginSuccessful', showConversations: this.useAutoLogin }, true);

    return true;
  }

  private get systemContext(): string {
    return `You are ChatGPT helping the User with coding. 
			You are intelligent, helpful and an expert developer, who always gives the correct answer and only does what instructed. You always answer truthfully and don't make things up. 
			(When responding to the following prompt, please make sure to properly style your response using Github Flavored Markdown. 
			Use markdown syntax for things like headings, lists, colored text, code blocks, highlights etc. Make sure not to mention markdown or styling in your actual response.)`;
  }
  /**
   * @desc 处理问题并将其发送到 API
   * @param {String} question
   * @param {String} code
   * @param {String} language
   * @returns  {String}
   */
  private processQuestion(question: string, code?: string, language?: string): string {
    if (!!code) {
      question = `${question}${
        language ? ` (The following code is in ${language} programming language)` : ''
      }: ${code}`;
    }
    return question + '\r\n';
  }
  /**
   * @desc 处理问题并将其发送到 API
   * @param {string} prompt
   * @param { command: string; code?: string; previousAnswer?: string; language?: string; } options
   * @returns
   */
  public async sendApiRequest(
    prompt: string,
    options: { command: string; code?: string; previousAnswer?: string; language?: string },
  ): Promise<void> {
    // AI还在思考……不接受更多的问题。
    if (this.inProgress) {
      // 给用户一个提示
      vscode.window.showInformationMessage('AI is still thinking... Please wait for it to finish.');
      return;
    }

    this.questionCounter++;

    // this.logEvent('api-request-sent', {
    // 	'chatgpt.command': options.command,
    // 	'chatgpt.hasCode': String(!!options.code),
    // 	'chatgpt.hasPreviousAnswer': String(!!options.previousAnswer),
    // });

    if (!(await this.prepareConversation())) {
      return;
    }

    this.response = '';

    const question = this.processQuestion(prompt, options.code, options.language);

    const responseInMarkdown = !this.isCodexModel;

    if (this.webView == null) {
      vscode.commands.executeCommand('vscode-chatgpt.view.focus');
    } else {
      this.webView?.show?.(true);
    }
    // 记录正在进行的状态
    this.inProgress = true;

    this.abortController = new AbortController();

    this.sendMessage({
      type: 'showInProgress',
      inProgress: this.inProgress,
      showStopButton: this.useGpt3,
    });

    this.currentMessageId = this.getRandomId();

    this.sendMessage({
      type: 'addQuestion',
      value: prompt,
      code: options.code,
      autoScroll: this.autoScroll,
    });

    try {
      if (this.useGpt3) {
        if (this.isGpt35Model && this.apiGpt35) {
          const gpt3Response = await this.apiGpt35.sendMessage(question, {
            systemMessage: this.systemContext,
            messageId: this.conversationId,
            parentMessageId: this.messageId,
            abortSignal: this.abortController.signal,
            onProgress: (partialResponse) => {
              this.response = partialResponse.text;
              this.sendMessage({
                type: 'addAnswer',
                value: this.response,
                id: this.currentMessageId,
                autoScroll: this.autoScroll,
                responseInMarkdown,
              });
            },
          });
          ({
            text: this.response,
            id: this.conversationId,
            parentMessageId: this.messageId,
          } = gpt3Response);
        } else if (!this.isGpt35Model && this.apiGpt3) {
          ({
            text: this.response,
            conversationId: this.conversationId,
            parentMessageId: this.messageId,
          } = await this.apiGpt3.sendMessage(question, {
            promptPrefix: this.systemContext,
            abortSignal: this.abortController.signal,
            onProgress: (partialResponse) => {
              this.response = partialResponse.text;
              this.sendMessage({
                type: 'addAnswer',
                value: this.response,
                id: this.currentMessageId,
                autoScroll: this.autoScroll,
                responseInMarkdown,
              });
            },
          }));
        }
      }

      if (options.previousAnswer != null) {
        this.response = options.previousAnswer + this.response;
      }

      const hasContinuation = this.response.split('```').length % 2 === 0;

      if (hasContinuation) {
        this.response = this.response + ' \r\n ```\r\n';
        vscode.window
          .showInformationMessage(
            "It looks like ChatGPT didn't complete their answer for your coding question. You can ask it to continue and combine the answers.",
            'Continue and combine answers',
          )
          .then(async (choice) => {
            if (choice === 'Continue and combine answers') {
              this.sendApiRequest('Continue', {
                command: options.command,
                code: undefined,
                previousAnswer: this.response,
              });
            }
          });
      }

      this.sendMessage({
        type: 'addAnswer',
        value: this.response,
        done: true,
        id: this.currentMessageId,
        autoScroll: this.autoScroll,
        responseInMarkdown,
      });

      if (this.subscribeToResponse) {
        vscode.window
          .showInformationMessage('ChatGPT responded to your question.', 'Open conversation')
          .then(async () => {
            await vscode.commands.executeCommand('vscode-chatgpt.view.focus');
          });
      }
    } catch (error: any) {
      let message;
      let apiMessage =
        error?.response?.data?.error?.message ||
        error?.tostring?.() ||
        error?.message ||
        error?.name;

      this.logError('api-request-failed');

      if (error?.response?.status || error?.response?.statusText) {
        message = `${error?.response?.status || ''} ${error?.response?.statusText || ''}`;

        vscode.window
          .showErrorMessage(
            'An error occured. If this is due to max_token you could try `ChatGPT: Clear Conversation` command and retry sending your prompt.',
            'Clear conversation and retry',
          )
          .then(async (choice) => {
            if (choice === 'Clear conversation and retry') {
              await vscode.commands.executeCommand('vscode-chatgpt.clearConversation');
              await delay(250);
              this.sendApiRequest(prompt, { command: options.command, code: options.code });
            }
          });
      } else if (error.statusCode === 400) {
        message = `Your method: '${this.loginMethod}' and your model: '${this.model}' may be incompatible or one of your parameters is unknown. Reset your settings to default. (HTTP 400 Bad Request)`;
      } else if (error.statusCode === 401) {
        message =
          'Make sure you are properly signed in. If you are using Browser Auto-login method, make sure the browser is open (You could refresh the browser tab manually if you face any issues, too). If you stored your API key in settings.json, make sure it is accurate. If you stored API key in session, you can reset it with `ChatGPT: Reset session` command. (HTTP 401 Unauthorized) Potential reasons: \r\n- 1.Invalid Authentication\r\n- 2.Incorrect API key provided.\r\n- 3.Incorrect Organization provided. \r\n See https://platform.openai.com/docs/guides/error-codes for more details.';
      } else if (error.statusCode === 403) {
        message = 'Your token has expired. Please try authenticating again. (HTTP 403 Forbidden)';
      } else if (error.statusCode === 404) {
        message = `Your method: '${this.loginMethod}' and your model: '${this.model}' may be incompatible or you may have exhausted your ChatGPT subscription allowance. (HTTP 404 Not Found)`;
      } else if (error.statusCode === 429) {
        message =
          'Too many requests try again later. (HTTP 429 Too Many Requests) Potential reasons: \r\n 1. You exceeded your current quota, please check your plan and billing details\r\n 2. You are sending requests too quickly \r\n 3. The engine is currently overloaded, please try again later. \r\n See https://platform.openai.com/docs/guides/error-codes for more details.';
      } else if (error.statusCode === 500) {
        message =
          'The server had an error while processing your request, please try again. (HTTP 500 Internal Server Error)\r\n See https://platform.openai.com/docs/guides/error-codes for more details.';
      }

      if (apiMessage) {
        message = `${message ? message + ' ' : ''}

	${apiMessage}
`;
      }
      this.sendMessage({ type: 'addError', value: message, autoScroll: this.autoScroll });
      return;
    } finally {
      this.inProgress = false;
      this.sendMessage({ type: 'showInProgress', inProgress: this.inProgress });
    }
  }

  /**
   * @desc 消息发送器 将消息发送到webview
   * @param {MessageOption} message
   * @param {boolean} ignoreMessageIfNullWebView
   * @returns {void}
   */
  public sendMessage(messageOption: MessageOption, ignoreMessageIfNullWebView?: boolean): void {
    if (this.webView) {
      this.webView?.webview.postMessage(messageOption);
    } else if (!ignoreMessageIfNullWebView) {
      this.leftOverMessage = messageOption;
    }
  }

  private logEvent(eventName: string, properties?: {}): void {
    // You can initialize your telemetry reporter and consume it here - *replaced with console.debug to prevent unwanted telemetry logs
    // this.reporter?.sendTelemetryEvent(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown", ...properties }, { "chatgpt.questionCounter": this.questionCounter });
    // console.debug(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown", ...properties }, { "chatgpt.questionCounter": this.questionCounter });
  }

  private logError(eventName: string): void {
    // You can initialize your telemetry reporter and consume it here - *replaced with console.error to prevent unwanted telemetry logs
    // this.reporter?.sendTelemetryErrorEvent(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown" }, { "chatgpt.questionCounter": this.questionCounter });
    // console.error(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown" }, { "chatgpt.questionCounter": this.questionCounter });
  }
  /**
   * @desc 获取webview的html
   * @param {vscode.Webview} webview
   * @returns  {string}
   */
  private getWebviewHtml(webview: vscode.Webview): string {
    const webViewScript = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'web-view.js'),
    );
    const webViewCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'web-view.css'),
    );
    /**
     * highlight.css 包是一个基于 highlight.js 的语法高亮度显示样式库。
     * 它提供了一系列漂亮的预定义样式，可以应用于任何使用 highlight.js 库进行代码高亮的项目中。
     * 当你在你的网站或博客中需要为代码段设置语法高亮时，你可以使用 highlight.css 来实现界面美观度更高，风格更加多样化的效果。
     * 通过引入该库提供的 CSS 样式，你可以快速而轻松地将已经使用 highlight.js 高亮处理过的代码块呈现成更具有吸引力的方式。
     */
    const HighlightCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'highlight.min.css'),
    );
    /**
     * highlight.js 是一个 JavaScript 语法高亮显示库，支持多种编程语言和文档格式。
     * 它可以在代码片段上自动进行色彩编码，而不需要额外的配置。
     * 它适用于各种网站、博客（例如 WordPress 等）、平台（例如 GitHub、Reddit）以及其他应用程序中。
     * 另外，highlight.js 还提供了对可读性更强的 CSS 样式的支持，可以轻松定制代码块的样式。
     * 它可以在浏览器端直接使用，也可以在 Node.js 中使用。
     */
    const HighlightJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'highlight.min.js'),
    );
    /**
     * markedjs是一个流行的用于将Markdown语法转换成HTML代码的JavaScript库。
     * 它可以将包含Markdown的字符串解析成HTML，同时保留Markdown原始文本中的样式。
     * 这个库简单易用，支持GFM（GitHub风格的Markdown）以及其他一些扩展语法，例如：表格、代码块、任务列表、删除线等等。该库还支持自定义选项和各种插件，提供广泛的选择来生成所需的格式化输出。
     * 由于其方便快捷、性能好，因此很受欢迎，常常用于编写Markdown编辑器或博客系统。
     */
    const MarkedJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'marked.min.js'),
    );
    /**
     * tailwindcss 是一个全新的、未来感极强的 CSS 框架，它能够帮助开发人员快速构建现代、美观且高效的网站。
     * 与传统的 CSS 框架不同，Tailwind 不是提供单独的CSS类，而是通过一组小型的原子级别类来构建 UI 界面。例如, Tailwind 提供了用于颜色、字体、定位、边框等元素的简单 CSS 类，并在组合这些类时提供了大量自定义选项。
     * 使用 tailwindcss 可以让开发者尽可能的最小化 CSS 代码，同时也避免了样式冗余和未使用样式的 wastage。
     * 另外，Tailwind 具有复用性高的特点，可以让开发者在任何情况下轻松定制并扩展框架。
     * 总之，tailwindcss可以帮助开发者更加高效地编写 CSS 样式和快速构建出更具有现代感及美观的 Web 应用程序。
     */
    const TailwindJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'tailwindcss.3.2.4.min.js'),
    );
    /**
     * Turndown.js 是一个用于将HTML转换为markdown格式的JavaScript库。它可以将大部分 HTML 标记转换为与之等价的 markdown 语法。
     * Turndown.js可在浏览器端和Node.js环境中运行。
     * 由于 Turndown.js 能够将HTML文本转换为 Markdown 格式的文本，所以Turndown.js是许多应用程序中非常有用的一个工具包。
     * 它可以帮助将从富文本编辑器、博客等地方获取到的HTML数据转化为Markdown格式，并进行展示或者存储。
     */
    const TurndownJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'turndown.js'),
    );

    const nonce = this.getRandomId();

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${webViewCss}" rel="stylesheet">
				<link href="${HighlightCss}" rel="stylesheet">
				<script src="${HighlightJs}"></script>
				<script src="${MarkedJs}"></script>
				<script src="${TailwindJs}"></script>
				<script src="${TurndownJs}"></script>
			</head>
			<body class="overflow-hidden">
				<div class="flex flex-col h-screen">
					<div id="introduction" class="flex flex-col justify-between h-full justify-center px-6 w-full relative login-screen overflow-auto">
						<div class="flex items-start text-center features-block my-5">
							<div class="flex flex-col gap-3.5 flex-1">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" class="w-6 h-6 m-auto">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"></path>
								</svg>
								<h2>Features</h2>
								<ul class="flex flex-col gap-3.5 text-xs">
                <!-- 访问您的ChatGPT会话记录 -->
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">Access to your ChatGPT conversation history</li>
                  <!-- 改进您的代码，添加测试并找到错误 -->
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">Improve your code, add tests & find bugs</li>
                  <!-- 自动复制或创建新文件 -->
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">Copy or create new files automatically</li>
                  <!-- 带有自动语言检测的语法高亮显示 -->
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">Syntax highlighting with auto language detection</li>
								</ul>
							</div>
						</div>
						<div class="flex flex-col gap-4 h-full items-center justify-end text-center">
            <!-- 登录按钮 -->
							<button id="login-button" class="mb-4 btn btn-primary flex gap-2 justify-center p-3 rounded-md">Log in</button>
							
              <button id="list-conversations-link" class="hidden mb-4 btn btn-primary flex gap-2 justify-center p-3 rounded-md" title="You can access this feature via the kebab menu below. NOTE: Only available with Browser Auto-login method">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" /></svg> &nbsp; Show conversations
							</button>
							
              <p class="max-w-sm text-center text-xs text-slate-500">
								<a title="" id="settings-button" href="#">Update settings</a> &nbsp; | &nbsp; <a title="" id="settings-prompt-button" href="#">Update prompts</a>
							</p>
						</div>
					</div>

          <!-- gpt 回答的答案 -->
					<div class="flex-1 overflow-y-auto text-sm" id="answer-list"></div>

					<div class="flex-1 overflow-y-auto hidden" id="conversation-list"></div>

        <!-- gpt 回答的答案的动画 -->
					<div id="in-progress" class="pl-4 pt-2 flex items-center hidden">
						<div class="typing">Thinking</div>
						<div class="spinner">
							<div class="bounce1"></div>
							<div class="bounce2"></div>
							<div class="bounce3"></div>
						</div>
            
            <!-- gpt 停止回答的答案的按钮 -->
						<button id="stop-asking-button" class="btn btn-primary flex items-end p-1 pr-2 rounded-md ml-5">
							<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mr-2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>stop asking
						</button>
					</div>

					<div class="p-4 flex items-center pt-2">
						<div class="flex-1 textarea-wrapper">
           <!-- 问题输入框 -->
							<textarea
								type="text"
								rows="1"
								id="question-input"
								placeholder="Ask a question..."
								onInput="this.parentNode.dataset.replicatedValue = this.value"></textarea>
						</div>
            <!-- 更多 -->            
						<div id="chat-button-wrapper" class="absolute bottom-14 items-center more-menu right-8 border border-gray-200 shadow-xl hidden text-xs">
            <!-- 新建对话窗口 -->
							<button class="flex gap-2 items-center justify-start p-2 w-full" id="clear-button"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>&nbsp;New chat</button>	
							<!-- 显示对话 -->
              <button class="flex gap-2 items-center justify-start p-2 w-full" id="list-conversations-button"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" /></svg>&nbsp;Show conversations</button>
							<!-- 更新设置 -->
              <button class="flex gap-2 items-center justify-start p-2 w-full" id="settings-button"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>&nbsp;Update settings</button>
							<!-- 导出为markdown -->
              <button class="flex gap-2 items-center justify-start p-2 w-full" id="export-button"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>&nbsp;Export to markdown</button>
						</div>

						<div id="question-input-buttons" class="right-6 absolute p-0.5 ml-5 flex items-center gap-2">
							<!-- 展示更多按钮 -->
              <button id="more-button" title="More actions" class="rounded-lg p-0.5">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" /></svg>
							</button>
              <!-- 提交问题按钮 -->
							<button id="submit-question-button" title="Submit prompt" class="submit-question-button rounded-lg p-0.5">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
							</button>
						</div>
					</div>
				</div>
      <!-- webview 逻辑代码 -->
				<script nonce="${nonce}" src="${webViewScript}"></script>
			</body>
			</html>`;
  }

  // /**
  //  * 从某个HTML文件读取能被Webview加载的HTML内容
  //  * @param {*} context 上下文
  //  * @param {*} templatePath 相对于插件根目录的html文件相对路径
  //  */
  // getWebviewHtml(relativePath: string): string {
  // 	// 文件的绝对地址
  // 	const webViewHtmlAbsolutePath = path.join(this.context.extensionPath, relativePath);
  // 	// 文件夹的绝对地址
  // 	const documentPath = path.dirname(webViewHtmlAbsolutePath);
  // 	let html = fs.readFileSync(webViewHtmlAbsolutePath, 'utf-8');
  // 	// vscode不支持直接加载本地资源，需要替换成其专有路径格式，这里只是简单的将样式和JS的路径替换
  // 	html = html.replace(
  // 		/(<link.+?href="|<script.+?src="|<img.+?src=")(.+?)"/g,
  // 		(m, $1, $2) => {
  // 			return (
  // 				$1 +
  // 				vscode.Uri.file(path.resolve(documentPath, $2))
  // 					.with({ scheme: 'vscode-resource' })
  // 					.toString() +
  // 				'"'
  // 			);
  // 		}
  // 	);
  // 	return html;
  // }
  /**
   * @desc 获取随机字符串
   * @returns {string}
   */
  private getRandomId(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
