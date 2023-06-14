/* eslint-disable @typescript-eslint/naming-convention */
import delay from 'delay';
import fetch from 'isomorphic-fetch';
import * as vscode from 'vscode';
import { GptModelAPI } from './gpt-model';
import { TextModleAPI } from './text-model';
import { OnDidReceiveMessageOptions, SendApiRequestOption, WebviewMessageOptions } from './types';
export default class ChatgptViewProvider implements vscode.WebviewViewProvider {
  private webView?: vscode.WebviewView;
  private textModel?: TextModleAPI;
  private gptModel?: GptModelAPI;
  private parentMessageId?: string;
  private questionCount: number = 0;
  private inProgress: boolean = false;
  private abortController?: AbortController;
  // 当前会话的id
  private currentConversationId: string = '';
  private response: string = '';
  private WebviewMessageOptions: WebviewMessageOptions | null = null;
  /**
   * 如果消息没有被渲染，则延迟渲染
   * 在调用 resolveWebviewView 之前的时间。
   */
  constructor(private context: vscode.ExtensionContext) {
    this.initConfig();
  }
  private get chatGptConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('chatgpt');
  }
  /**
   * @desc chatgpt模型是否是 "gpt-3.5-turbo","gpt-3.5-turbo-0301","gpt-4"
   * @returns {boolean}
   */
  private get isGptModel(): boolean {
    return !!this.model?.startsWith('gpt-');
  }
  /**
   * @desc chatgpt模型是否是 "text-davinci-003, text-babbage-001, text-ada-001"
   * @returns {boolean}
   */
  private get isTextModel(): boolean {
    return !!this.model?.startsWith('text-');
  }
  /**
   * @desc 回答问题是否自动滚动到底部
   * @returns {boolean}
   */
  private get autoScroll(): boolean {
    return this.chatGptConfig.get<boolean>('response.autoScroll') || false;
  }
  /**
   * @desc 是否订阅回答
   * @returns {boolean}
   */
  private get subscribeToResponse(): boolean {
    return this.chatGptConfig.get<boolean>('response.subscribeToResponse') || false;
  }
  /**
   * @desc gpt 模型
   * @returns {string}
   */
  private get model(): string {
    return this.chatGptConfig.get<string>('gpt.model') || '';
  }
  /**
   * @desc gpt organization 参数
   * @returns {string}
   */
  private get organization(): string {
    return this.chatGptConfig.get<string>('gpt.organization') || '';
  }
  /**
   * @desc gpt max_tokens 参数
   * @returns {number}
   */
  private get max_tokens(): number {
    return this.chatGptConfig.get<number>('gpt.maxTokens') || 2048;
  }
  /**
   * @desc gpt temperature 参数
   * @returns {number}
   */
  private get temperature(): number {
    return this.chatGptConfig.get<number>('gpt.temperature') || 0.9;
  }
  /**
   * @desc gpt top_p 参数
   * @returns {number}
   */
  private get top_p(): number {
    return this.chatGptConfig.get<number>('gpt.top_p') || 1;
  }

  private get withContent(): boolean {
    return this.chatGptConfig.get<boolean>('gpt.withContent') || false;
  }
  /**
   * @desc gpt apiBaseUrl 参数
   * @returns {string}
   */
  private get apiBaseUrl(): string {
    return this.chatGptConfig.get<string>('gpt.apiBaseUrl')?.trim() || '';
  }

  private get apiKey(): string {
    const globalState = this.context.globalState;
    const apiKey =
      this.chatGptConfig.get<string>('gpt.apiKey') ||
      globalState.get<string>('chatgpt-gpt-apiKey') ||
      '';
    return apiKey;
  }
  /**
   * @desc 给chatgpt的系统信息
   * @returns {string}
   */
  private get systemMessage(): string {
    return this.chatGptConfig.get<string>('gpt.systemMessage') || '';
  }
  private webviewViewOnDidReceiveMessage(webviewView: vscode.WebviewView): void {
    // 在监听器内部根据消息命令类型执行不同的操作。
    webviewView.webview.onDidReceiveMessage(async (data: OnDidReceiveMessageOptions) => {
      switch (data.type) {
        case 'add-question':
          const question = data.value || '';
          this.sendApiRequest(question, { command: 'freeText' });
          break;
        case 'insert-code':
          // 插入代码
          const code = data.value || '';
          const escapedString = code.replace(/\$/g, '\\$');
          vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(escapedString));
          break;
        case 'open-newtab':
          // 打开新的tab页
          const document = await vscode.workspace.openTextDocument({
            content: data.value,
            language: data.language,
          });
          vscode.window.showTextDocument(document);
          break;
        case 'clear-conversation':
          // 清空会话
          this.parentMessageId = undefined;
          this.gptModel?._clearMessage();
          this.textModel?._clearMessage();
          break;
        case 'open-settings':
          // 打开设置
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:xcy960815.vscode-chatgpt-plugin chatgpt.',
          );
          break;
        case 'update-key':
          // 更新apikey
          const apiKey = await this.showNoApiKeyInput(this.apiKey);
          if (apiKey) {
            // const globalState = this.context.globalState;
            // globalState.update('chatgpt-gpt-apiKey', apiKey);
          }
          break;
        case 'open-prompt-settings':
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:xcy960815.vscode-chatgpt-plugin promptPrefix',
          );
          break;
        // case 'show-conversations':
        //   // 显示对话
        //   break;
        // case 'show-conversation':
        //   break;
        case 'stop-generating':
          // 停止生成代码
          this.stopGenerating();
          break;
        case 'get-chatgpt-config':
          this.sendMessageToWebview(
            {
              type: 'set-chatgpt-config',
              value: this.chatGptConfig,
            },
            true,
          );
          break;
        default:
          break;
      }
    });
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
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    // 设置webview的html内容
    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);
    this.webviewViewOnDidReceiveMessage(webviewView);
  }
  /**
   * @desc 终止生成代码
   * @returns {void}
   */
  private stopGenerating(): void {
    this.abortController?.abort?.();
    this.inProgress = false;
    this.sendMessageToWebview({ type: 'show-in-progress', inProgress: this.inProgress });
    this.sendMessageToWebview({
      type: 'add-answer',
      value: this.response,
      done: true,
      id: this.currentConversationId,
      autoScroll: this.autoScroll,
    });
  }
  /**
   * @desc 清空会话
   * @returns {void}
   */
  public clearSession(): void {
    this.stopGenerating();
    this.textModel?._clearMessage();
    this.textModel = undefined;
    this.gptModel?._clearMessage();
    this.gptModel = undefined;
    this.parentMessageId = undefined;
  }
  /**
   * @desc 初始化会话
   * @returns {Promise<boolean>}
   */
  public async initConfig(gptConfigChanged?: boolean): Promise<boolean> {
    const hasApiKey = await this.checkAPIExistence();
    if (!hasApiKey) {
      return false;
    }
    if (!this.textModel || !this.gptModel || gptConfigChanged) {
      return await this.initChatGPTModel();
    } else {
      return true;
    }
  }
  /**
   * @desc 检查api是否存在
   * @returns {Promise<boolean>}
   */
  private async checkAPIExistence(): Promise<boolean> {
    if (!this.apiKey) {
      return await this.promptApiKey();
    } else {
      return true;
    }
  }
  /**
   * @desc 初始化chatgpt模型
   * @returns {Promise<boolean>}
   */
  private async initChatGPTModel(): Promise<boolean> {
    // 初始化chatgpt模型
    this.gptModel = new GptModelAPI({
      apiKey: this.apiKey,
      fetch: fetch,
      apiBaseUrl: this.apiBaseUrl,
      organization: this.organization,
      withContent: this.withContent,
      CompletionRequestParams: {
        model: this.model,
        max_tokens: this.max_tokens,
        temperature: this.temperature,
        top_p: this.top_p,
      },
    });
    this.textModel = new TextModleAPI({
      apiKey: this.apiKey,
      fetch: fetch,
      apiBaseUrl: this.apiBaseUrl,
      organization: this.organization,
      withContent: this.withContent,
      CompletionRequestParams: {
        model: this.model,
        max_tokens: this.max_tokens,
        temperature: this.temperature,
        top_p: this.top_p,
      },
    });
    return true;
  }
  /**
   * @desc 提示输入apiKey
   * @returns {Promise<boolean>}
   */
  private async promptApiKey(): Promise<boolean> {
    const noApiKeyMessage = this.chatGptConfig.get<string>('pageMessage.noApiKey.message')!;
    const noApiKeyChoose1 = this.chatGptConfig.get<string>('pageMessage.noApiKey.choose1')!;
    const noApiKeyChoose2 = this.chatGptConfig.get<string>('pageMessage.noApiKey.choose2')!;
    const choice = await vscode.window.showErrorMessage(
      noApiKeyMessage,
      noApiKeyChoose1,
      noApiKeyChoose2,
    );
    if (choice === noApiKeyChoose1) {
      const apiKeyValue = await this.showNoApiKeyInput();
      if (apiKeyValue?.trim()) {
        // 全局状态
        const globalState = this.context.globalState;
        // 存储在全局状态中
        globalState.update('chatgpt-gpt-apiKey', apiKeyValue?.trim());
        return true;
      } else {
        return false;
      }
    } else if (choice === noApiKeyChoose2) {
      // 打开关于openai apiKey的设置项
      vscode.commands.executeCommand('workbench.action.openSettings', 'chatgpt.gpt.apiKey');
      return false;
    } else {
      return false;
    }
  }

  private async showNoApiKeyInput(apikey?: string): Promise<string> {
    const noApiKeyInputTitle = this.chatGptConfig.get<string>(
      'pageMessage.noApiKey.inputBox.title',
    )!;
    const noApiKeyInputPrompt = this.chatGptConfig.get<string>(
      'pageMessage.noApiKey.inputBox.prompt',
    )!;
    const noApiKeyInputPlaceHolder = this.chatGptConfig.get<string>(
      'pageMessage.noApiKey.inputBox.placeHolder',
    )!;
    apikey = apikey || '';

    const newApiKey = await vscode.window.showInputBox({
      title: noApiKeyInputTitle,
      prompt: noApiKeyInputPrompt,
      ignoreFocusOut: true,
      value: apikey,
      placeHolder: noApiKeyInputPlaceHolder,
    });
    return newApiKey || '';
  }

  private buildQuestion(question: string, code?: string, language?: string): string {
    if (!!code) {
      // question = `${question}${language ? ` (The following code is in ${language} programming language)` : ''}: ${code}`;
      question = `${question}: ${code}`;
    }
    return question; //+ '\r\n';
  }
  private async showWebview(): Promise<void> {
    if (this.webView === undefined) {
      // 触发resolveWebviewView事件
      await vscode.commands.executeCommand('vscode-chatgpt-plugin.view.focus');
      await delay(250);
      if (this.WebviewMessageOptions !== null) {
        this.sendMessageToWebview(this.WebviewMessageOptions);
        this.WebviewMessageOptions = null;
      }
    } else {
      await this.webView?.show?.(true);
    }
  }
  private setInProgressStatus(status: boolean): void {
    this.inProgress = status;
  }
  private createAbortController(): void {
    this.abortController = new AbortController();
  }
  private processPreviousAnswer(option: SendApiRequestOption): void {
    if (!!option.previousAnswer) {
      this.response = option.previousAnswer + this.response;
    }
  }
  private async checkForContinuation(option: SendApiRequestOption): Promise<void> {
    const hasContinuation = this.response.split('```').length % 2 === 0;
    if (hasContinuation) {
      // 如果需要继续执行，请处理逻辑
      this.response = this.response + ' \r\n ```\r\n';
      const dontCompleteMessage = this.chatGptConfig.get<string>(
        'pageMessage.dontComplete.message',
      )!;
      const dontCompleteChoose = this.chatGptConfig.get<string>('pageMessage.dontComplete.choose')!;
      const choice = await vscode.window.showInformationMessage(
        dontCompleteMessage,
        dontCompleteChoose,
      );
      if (choice === dontCompleteChoose) {
        const prompt = this.chatGptConfig.get<string>('pageMessage.dontComplete.prompt') || '';
        this.sendApiRequest(prompt, {
          command: option.command,
          code: undefined,
          previousAnswer: this.response,
        });
      }
    }
  }

  private async subscribeToResponsePrompt(): Promise<void> {
    // 如果打开了订阅对话的配置
    if (this.subscribeToResponse) {
      // 给用户通知
      const subscribeToResponseMessage =
        this.chatGptConfig.get<string>('pageMessage.subscribeToResponse.message') || '';
      const subscribeToResponseChoose =
        this.chatGptConfig.get<string>('pageMessage.subscribeToResponse.choose') || '';
      vscode.window
        .showInformationMessage(subscribeToResponseMessage, subscribeToResponseChoose)
        .then(async () => {
          // 打开窗口
          await vscode.commands.executeCommand('vscode-chatgpt-plugin.view.focus');
        });
    }
  }

  private getErrorMessageFromErrorType(error: any): string {
    switch (error.statusCode) {
      case 400:
        const errorMessage400 =
          this.chatGptConfig.get<string>('pageMessage.400.error.message') || '';
        return errorMessage400.replace('${model}', this.model);
      case 401:
        const errorMessage401 =
          this.chatGptConfig.get<string>('pageMessage.401.error.message') || '';
        return errorMessage401;
      case 403:
        const errorMessage403 =
          this.chatGptConfig.get<string>('pageMessage.403.error.message') || '';
        return errorMessage403;
      case 404:
        const errorMessage404 =
          this.chatGptConfig.get<string>('pageMessage.404.error.message') || '';
        return errorMessage404.replace('${model}', this.model);
      case 429:
        const errorMessage429 =
          this.chatGptConfig.get<string>('pageMessage.429.error.message') || '';
        return errorMessage429;
      case 500:
        const errorMessage500 =
          this.chatGptConfig.get<string>('pageMessage.500.error.message') || '';
        return errorMessage500;
    }
    return '';
  }

  private async handleErrorDialog(prompt: string, option: SendApiRequestOption) {
    // 从配置中获取错误信息
    const errorMessage = this.chatGptConfig.get<string>('pageMessage.maxToken.error.message') || '';
    // 从配置中获取错误选择
    const errorChoose = this.chatGptConfig.get<string>('pageMessage.maxToken.error.choose') || '';
    vscode.window.showErrorMessage(errorMessage, errorChoose).then(async (choice) => {
      if (choice === errorChoose) {
        await vscode.commands.executeCommand('vscode-chatgpt.clearConversation');
        await delay(250);
        this.sendApiRequest(prompt, { command: option.command, code: option.code });
      }
    });
  }

  private handleErrorResponse(error: any, prompt: string, option: SendApiRequestOption): void {
    const statusCode = error?.response?.status;
    const statusText = error?.response?.statusText;
    if (statusCode || statusText) {
      this.handleErrorDialog(prompt, option);
    } else {
      const message = this.getErrorMessageFromErrorType(error);
      const apiErrorMessage =
        error?.response?.data?.error?.message || error?.tostring?.() || error?.message;
      const errorMessage = `${message ? message + ' ' : ''}${
        apiErrorMessage ? apiErrorMessage : ''
      }`;
      this.sendMessageToWebview({
        type: 'add-error',
        value: errorMessage,
        autoScroll: this.autoScroll,
      });
    }
  }

  /**
   * @desc 处理问题并将其发送到 API
   * @param {string} prompt
   * @param {SendApiRequestOption} option
   * @returns
   */
  public async sendApiRequest(prompt: string, option: SendApiRequestOption): Promise<void> {
    if (this.inProgress) {
      return;
    }
    this.questionCount++;

    // 校验是否登录
    if (!(await this.initConfig())) {
      return;
    }
    this.response = '';
    const question = this.buildQuestion(prompt, option.code, option.language);
    await this.showWebview();
    this.setInProgressStatus(true);
    this.createAbortController();
    this.sendMessageToWebview({
      type: 'show-in-progress',
      inProgress: this.inProgress,
      showStopButton: true,
    });
    this.currentConversationId = this.getRandomId();
    // 要始终保持 messageId 的唯一性
    const messageId = this.getRandomId();
    this.sendMessageToWebview({
      type: 'add-question',
      value: prompt,
      code: option.code,
      autoScroll: this.autoScroll,
    });

    try {
      if (this.isGptModel && this.gptModel) {
        const response = await this.gptModel.sendMessage(question, {
          systemMessage: this.systemMessage,
          messageId,
          parentMessageId: this.parentMessageId,
          abortSignal: this.abortController?.signal,
          onProgress: (partialResponse) => {
            this.response = partialResponse.text;
            this.sendMessageToWebview({
              type: 'add-answer',
              value: this.response,
              id: this.currentConversationId,
              autoScroll: this.autoScroll,
            });
          },
        });
        this.response = response.text;
        this.parentMessageId = response.parentMessageId;
      }
      if (this.isTextModel && this.textModel) {
        const response = await this.textModel.sendMessage(question, {
          systemMessage: this.systemMessage,
          abortSignal: this.abortController?.signal,
          messageId,
          parentMessageId: this.parentMessageId,
          onProgress: (partialResponse) => {
            this.response = partialResponse.text;
            this.sendMessageToWebview({
              type: 'add-answer',
              value: this.response,
              id: this.currentConversationId,
              autoScroll: this.autoScroll,
            });
          },
        });
        this.response = response.text;
        this.parentMessageId = response.parentMessageId;
      }
      await this.processPreviousAnswer(option);
      this.checkForContinuation(option);
      // 回答完毕
      this.sendMessageToWebview({
        type: 'add-answer',
        value: this.response,
        done: true,
        id: this.currentConversationId,
        autoScroll: this.autoScroll,
      });
      await this.subscribeToResponsePrompt();
    } catch (error: any) {
      this.handleErrorResponse(error, prompt, option);
      return;
    } finally {
      this.inProgress = false;
      this.sendMessageToWebview({ type: 'show-in-progress', inProgress: this.inProgress });
    }
  }
  /**
   * @desc 消息发送器 将消息发送到webview
   * @param {WebviewMessageOptions} WebviewMessageOptions
   * @param {boolean} ignoreMessageIfNullWebView
   * @returns {void}
   */
  public sendMessageToWebview(
    WebviewMessageOptions: WebviewMessageOptions,
    ignoreMessageIfNullWebView?: boolean,
  ): void {
    if (this.webView) {
      this.webView?.webview.postMessage(WebviewMessageOptions);
    } else if (!ignoreMessageIfNullWebView) {
      this.WebviewMessageOptions = WebviewMessageOptions;
    }
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
    const HighlightCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'highlight.min.css'),
    );
    const HighlightJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'highlight.min.js'),
    );
    const MarkedJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'marked.min.js'),
    );
    const TailwindJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'tailwindcss.3.2.4.min.js'),
    );
    const TurndownJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'turndown.js'),
    );
    const features = this.chatGptConfig.get<string>('webview.features');
    const feature1 = this.chatGptConfig.get<string>('webview.feature1');
    const feature2 = this.chatGptConfig.get<string>('webview.feature2');
    const feature3 = this.chatGptConfig.get<string>('webview.feature3');
    const feature4 = this.chatGptConfig.get<string>('webview.feature4');
    const loginButtonName = this.chatGptConfig.get<string>('webview.loginButtonName');
    const loginButtonTitle = this.chatGptConfig.get<string>('webview.loginButtonTitle');

    const updateSettingsButtonName = this.chatGptConfig.get<string>(
      'webview.updateSettingsButtonName',
    );
    const updateSettingsButtonTitle = this.chatGptConfig.get<string>(
      'webview.updateSettingsButtonTitle',
    );

    const updateApiKeyButtonTitle = this.chatGptConfig.get<string>(
      'webview.updateApiKeyButtonTitle',
    );
    const updateApiKeyButtonName = this.chatGptConfig.get<string>('webview.updateApiKeyButtonName');

    const updatePromptsButtonName = this.chatGptConfig.get<string>(
      'webview.updatePromptsButtonName',
    );
    const updatePromptsButtonTitle = this.chatGptConfig.get<string>(
      'webview.updatePromptsButtonTitle',
    );

    const questionInputPlaceholder = this.chatGptConfig.get<string>(
      'webview.questionInputPlaceholder',
    );
    const clearConversationButtonName = this.chatGptConfig.get<string>(
      'webview.clearConversationButtonName',
    );
    const clearConversationButtonTitle = this.chatGptConfig.get<string>(
      'webview.clearConversationButtonTitle',
    );

    const showConversationsButtonName = this.chatGptConfig.get<string>(
      'webview.showConversationsButtonName',
    );
    const showConversationsButtonTitle = this.chatGptConfig.get<string>(
      'webview.showConversationsButtonTitle',
    );
    const exportConversationButtonName = this.chatGptConfig.get<string>(
      'webview.exportConversationButtonName',
    );
    const exportConversationButtonTitle = this.chatGptConfig.get<string>(
      'webview.exportConversationButtonTitle',
    );

    // const moreActionsButtonName = this.chatGptConfig.get<string>('webview.moreActionsButtonName');
    const moreActionsButtonTitle = this.chatGptConfig.get<string>('webview.moreActionsButtonTitle');

    // const submitQuestionButtonName = this.chatGptConfig.get<string>(
    //   'webview.submitQuestionButtonName',
    // );
    const submitQuestionButtonTitle = this.chatGptConfig.get<string>(
      'webview.submitQuestionButtonTitle',
    );
    const featuresSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" class="w-6 h-6 m-auto">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"></path>
    </svg>`;
    const stopGeneratingSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mr-2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>`;
    const showConversationSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
      <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>`;
    const showConversationsSvg2 = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
      <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>`;
    const clearConversationSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>`;
    const updateSettingsSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>`;

    const exportConversationSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>`;
    const moreActionsSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
    </svg>`;
    const submitQuestionSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>`;

    const updateApiKeySvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
      <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>`;

    // <!--更新api key-- >
    //   ${
    //     this.apiKey
    //     ? `
    //           <button title=${updateApiKeyButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="update-key-button">
    //             ${updateApiKeySvg}&nbsp;${updateApiKeyButtonName}
    //           </button>`
    //     : '';
    // }

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
          <!-- 整体介绍 -->
					<div id="introduction" class="flex flex-col justify-between h-full justify-center px-6 w-full relative login-screen overflow-auto">
						<div class="flex items-start text-center features-block my-5">
							<div class="flex flex-col gap-3.5 flex-1">
								${featuresSvg}
                <!-- 现有功能 -->
								<h2>${features}</h2>
								<ul class="flex flex-col gap-3.5 text-xs">
                  <!-- 访问您的ChatGPT会话记录 -->
								  <li class="features-li w-full border border-zinc-700 p-3 rounded-md">${feature1}</li> 
                  <!-- 改进您的代码，添加测试并找到错误 -->
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">${feature2}</li>
                  <!-- 自动复制或创建新文件 -->
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">${feature3}</li>
                  <!-- 带有自动语言检测的语法高亮显示 -->
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">${feature4}</li>
								</ul>
							</div>
						</div>
						<div class="flex flex-col gap-4 h-full items-center justify-end text-center">
              <!-- 登录按钮 -->
							<!-- <button id="login-button" class="mb-4 btn btn-primary flex gap-2 justify-center p-3 rounded-md text-xs" title=${loginButtonTitle}>${loginButtonName}</button> -->
              <!-- 显示对话按钮 -->
              <!-- <button id="show-conversations-button2" class="hidden mb-4 btn btn-primary flex gap-2 justify-center p-3 rounded-md text-xs" :title="${showConversationsButtonTitle}">
								${showConversationSvg}&nbsp;${showConversationsButtonName}
							</button> -->
              <p class="max-w-sm text-center text-xs text-slate-500">
                <!-- 更新设置和更新提示按钮 -->
								<a id="update-settings-button" title=${updateSettingsButtonTitle} href="#">${updateSettingsButtonName}</a> &nbsp; | &nbsp; <a id="settings-prompt-button" title=${updatePromptsButtonTitle} href="#">${updatePromptsButtonName}</a>
							</p>
						</div>
					</div>
          <!-- gpt 回答的答案列表 -->
					<div class="flex-1 overflow-y-auto text-sm" id="answer-list"></div>
          <!-- gpt 对话列表 -->
					<div class="flex-1 overflow-y-auto hidden" id="conversation-list"></div>
          <!-- gpt 回答的答案的动画  -->
					<div id="in-progress" class="hidden pl-4 pr-4 pt-2 flex items-center justify-between text-xs ">
						<div class="typing flex items-center">
              <span>Asking</span>
              <div class="spinner">
                <div class="bounce1"></div>
                <div class="bounce2"></div>
                <div class="bounce3"></div>
              </div>
            </div>
            <!-- gpt 停止回答的答案的按钮 -->
						<button id="stop-generating-button" class="btn btn-primary flex items-center p-1 pr-2 rounded-md ml-5">
						  ${stopGeneratingSvg} Stop responding
						</button>
            </div>

					<div class="p-4 flex items-center pt-2">
						<div class="flex-1 textarea-wrapper">
              <!-- 问题输入框 -->
							<textarea
                class="w-full h-full text-sm rounded-md"
								type="text"
								rows="1"
								id="question-input"
								placeholder=${questionInputPlaceholder}
								onInput="this.parentNode.dataset.replicatedValue = this.value"></textarea>
						</div>
            <!-- 更多 -->            
						<div id="chat-button-wrapper" class="absolute bottom-14 items-center more-menu right-8 border border-gray-200 shadow-xl hidden text-xs">
              <!-- 清除对话 -->
							<button title=${clearConversationButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="clear-conversation-button">
                ${clearConversationSvg}&nbsp;${clearConversationButtonName}
              </button>	
							<!-- 显示对话按钮 -->
              <!-- <button title=${showConversationsButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="show-conversations-button">
                ${showConversationsSvg2}&nbsp;${showConversationsButtonName}
              </button> -->
							<!-- 更新设置 -->
              <button title=${updateSettingsButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="update-settings-button">
                ${updateSettingsSvg}&nbsp;${updateSettingsButtonName}
              </button>
							<!-- 导出对话为markdown -->
              <button title=${exportConversationButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="export-conversation-button">
                ${exportConversationSvg}&nbsp;${exportConversationButtonName}
              </button>
						</div>
						<div id="question-input-buttons" class="right-6 absolute p-0.5 ml-5 flex items-center gap-2">
							<!-- 展示更多按钮 -->
              <button id="more-button" title=${moreActionsButtonTitle} class="rounded-lg p-0.5">
								${moreActionsSvg}
							</button>
              <!-- 提交问题按钮 -->
							<button id="submit-question-button" title=${submitQuestionButtonTitle} class="submit-question-button rounded-lg p-0.5">
								${submitQuestionSvg}
							</button>
						</div>
					</div>
				</div>
      <!-- webview 逻辑代码 -->
				<script nonce="${nonce}" src="${webViewScript}"></script>
			</body>
			</html>`;
  }
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
