/* eslint-disable @typescript-eslint/naming-convention */
import Gpt3Tokenizer from 'gpt3-tokenizer';
import isomorphicFetch from 'isomorphic-fetch';
import Keyv from 'keyv';
import pTimeout, { ClearablePromise } from 'p-timeout';
import QuickLRU from 'quick-lru';
import { v4 as uuidv4 } from 'uuid';
import * as vscode from 'vscode';
import { Fetch, FetchSSEOptions, openai } from './types';
import { fetchSSE } from './utils';
const MODEL = 'gpt-3.5-turbo';

export class GptModelAPI {
  private _exceededMessage: string;
  private _apiKey: string;
  private _apiBaseUrl: string;
  private _organization?: string;
  private _debug: boolean;
  private _fetch: Fetch;
  private _withContent: boolean;
  private _CompletionRequestParams: Partial<
    Omit<openai.GptModelAPI.CompletionRequestParams, 'messages' | 'n' | 'stream'>
  >;
  private _systemMessage: string;
  private _maxModelTokens: number;
  private _maxResponseTokens: number;
  public _getMessageById: openai.GptModelAPI.GetMessageById;
  private _upsertMessage: openai.GptModelAPI.UpsertMessage;
  private _messageStore: Keyv<openai.GptModelAPI.ApiResponse>;
  _gpt3Tokenizer: Gpt3Tokenizer;
  constructor(options: openai.GptModelAPI.GptModelApiOptions, exceededMessage: string) {
    const {
      apiKey,
      apiBaseUrl,
      organization,
      debug,
      messageStore,
      CompletionRequestParams,
      systemMessage,
      maxModelTokens,
      maxResponseTokens,
      getMessageById,
      upsertMessage,
      fetch,
      withContent,
    } = options;
    this._apiKey = apiKey;
    this._apiBaseUrl = apiBaseUrl || 'https://api.openai.com';
    this._organization = organization;
    this._debug = !!debug;
    this._fetch = fetch || isomorphicFetch;
    this._withContent = withContent === undefined ? true : withContent;
    this._exceededMessage = exceededMessage;
    this._CompletionRequestParams = {
      model: MODEL,
      temperature: 0.8,
      top_p: 1,
      presence_penalty: 1,
      ...CompletionRequestParams,
    };
    this._systemMessage = systemMessage || '';
    this._maxModelTokens = maxModelTokens || 4000;
    this._maxResponseTokens = maxResponseTokens || 1000;
    this._getMessageById = getMessageById || this._defaultGetMessageById;
    this._upsertMessage = upsertMessage || this._defaultUpsertMessage;
    this._gpt3Tokenizer = new Gpt3Tokenizer({ type: 'gpt3' });
    if (messageStore) {
      this._messageStore = messageStore;
    } else {
      this._messageStore = new Keyv({
        store: new QuickLRU({ maxSize: 1e4 }),
      });
    }
  }
  /**
   * @desc 获取请求头
   * @returns {HeadersInit}
   */
  private get headers(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this._apiKey}`,
    };
    if (this._organization) {
      headers['OpenAI-Organization'] = this._organization;
    }
    return headers;
  }
  /**
   * @desc 发送消息
   * @param {string} text
   * @param {SendMessageOptions} options
   * @returns {Promise<ApiResponse>}
   */
  public async sendMessage(
    text: string,
    options: openai.GptModelAPI.SendMessageOptions,
  ): Promise<openai.GptModelAPI.ApiResponse> {
    const {
      parentMessageId,
      messageId = uuidv4(),
      timeoutMs,
      onProgress,
      stream = onProgress ? true : false,
      CompletionRequestParams,
    } = options;
    let { abortSignal } = options;
    let abortController: AbortController | null = null;
    // 如果设置了超时时间，那么就使用 AbortController
    if (timeoutMs && !abortSignal) {
      abortController = new AbortController();
      abortSignal = abortController.signal;
    }
    // 构建用户消息
    const userMessage: openai.GptModelAPI.UserMessage = {
      role: 'user',
      messageId,
      parentMessageId,
      text,
    };
    // 保存用户消息
    /* 下面是userMessage的例子
    {
      role: "user",
      messageId: "SSxiAgT3TZPmJoasYzVdnKfXMVWJroPD",
      parentMessageId: undefined,
      text: "你好",
    }
     */
    await this._upsertMessage(userMessage);

    // 获取用户和gpt历史对话记录
    const { messages } = await this._buildMessages(text, options);
    // 给用户返回的数据, 注意这里: parentMessageId = messageId
    const apiResponse: openai.GptModelAPI.ApiResponse =
    {
      role: 'assistant',
      messageId: '',
      parentMessageId: messageId,
      text: '',
      detail: null,
    };
    const responseP = new Promise<openai.GptModelAPI.ApiResponse>(async (resolve, reject) => {
      const url = `${this._apiBaseUrl}/v1/chat/completions`;
      const body = {
        ...this._CompletionRequestParams,
        ...CompletionRequestParams,
        messages,
        stream,
      };

      const fetchSSEOptions: FetchSSEOptions = {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: abortSignal,
      };
      if (stream) {
        fetchSSEOptions.onMessage = (data: string) => {
          if (data === '[DONE]') {
            apiResponse.text = apiResponse.text.trim();
            resolve(apiResponse);
            return;
          }
          try {
            const response: openai.GptModelAPI.CompletionResponse = JSON.parse(data);
            if (response.id) {
              apiResponse.messageId = response.id;
            }
            if (response?.choices?.length) {
              const delta = response.choices[0].delta;
              apiResponse.delta = delta.content;
              if (delta?.content) {
                apiResponse.text += delta.content;
              }
              apiResponse.detail = response;
              if (delta?.role) {
                apiResponse.role = delta.role;
              }
              // 这里调用前面设置的回调（回显数据到panel中）
              onProgress?.(apiResponse);

              if (response.choices[0]?.finish_reason !== null) {
                // 发现部分api中没有上述的[DONE]结束标识，这里使用 finish_reason非空 判断是否结束.
                if (response.choices[0]?.finish_reason === "length") {
                  vscode.window.showInformationMessage(this._exceededMessage);
                }
                apiResponse.text = apiResponse.text.trim();
                resolve(apiResponse);
                return;
              }
            }
          } catch (error) {
            console.error('OpenAI stream SEE event unexpected error', error);
            return reject(error);
          }
        };
        fetchSSE(url, fetchSSEOptions, this._fetch).catch(reject);
      } else {
        try {
          const data = await fetchSSE(url, fetchSSEOptions, this._fetch);
          const response: openai.GptModelAPI.CompletionResponse = await data?.json();
          if (response?.id) {
            apiResponse.messageId = response.id;
          }
          if (response?.choices?.length) {
            const message = response.choices[0].message;
            apiResponse.text = message?.content || '';
            apiResponse.role = message?.role || 'assistant';
          }
          apiResponse.detail = response;
          resolve(apiResponse);
        } catch (error) {
          console.error('OpenAI stream SEE event unexpected error', error);
          return reject(error);
        }
      }
    }).then((messageResult) => {
      // 保存消息
      /*
      {
        role: "assistant",
        messageId: "1e97eae0-ac1d-47f4-bbd2-844e5cc2d3d7",
        parentMessageId: "rzY7WhGLnlaPPwP5dn2eWALI8VT0eSxC",
        text: "Hello! How can I help you today? Need some help with coding?",
        detail: {
          id: "1e97eae0-ac1d-47f4-bbd2-844e5cc2d3d7",
          choices: [
            {
              delta: {
                content: "",
                function_call: null,
                role: null,
                tool_calls: null,
              },
              finish_reason: "stop",
              index: 0,
              logprobs: null,
            },
          ],
          created: 8818665,
          model: "deepseek-chat",
          object: "chat.completion.chunk",
          system_fingerprint: null,
          usage: {
            prompt_tokens: 112,
            completion_tokens: 15,
            total_tokens: 127,
          },
        },
        delta: "",
      }
      */
      return this._upsertMessage(messageResult).then(() => {
        messageResult.parentMessageId = messageResult.messageId;
        return messageResult;
      });
    });

    /* 如果设置了超时时间，那么就使用 AbortController */
    if (timeoutMs) {
      (responseP as ClearablePromise<openai.GptModelAPI.ApiResponse>).clear = () => {
        abortController?.abort();
      };
      return pTimeout(responseP, {
        milliseconds: timeoutMs,
        message: 'OpenAI timed out waiting for response',
      });
    } else {
      return responseP;
    }
  }
  /**
   * @desc 获取token数量
   * @param {string} text
   * @returns {Promise<number>}
   */
  private async _getTokenCount(text: string): Promise<number> {
    return this._gpt3Tokenizer.encode(text).bpe.length;
  }
  /**
   * @desc 获取 vscode 的配置项
   */
  private get chatGptConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('chatgpt');
  }
  /**
   * @desc 获取 vscode 的配置项中的 enableChatRound
   */
  private get enableChatRound(): boolean {
    return this.chatGptConfig.get<boolean>('history.chatRound-enabled') || false;
  }
  /**
   * @desc 获取 vscode 的配置项中的 chatRound
   */
  private get chatRound(): number {
    return this.chatGptConfig.get<number>('history.chatRound') || 3;
  }
  /**
   * @desc 构建消息
   * @param {string} text
   * @param {SendMessageOptions} options
   * @returns {Promise<{ messages: openai.GptModelAPI.CompletionRequestMessage[]; }>}
   */
  private async _buildMessages(
    text: string,
    options: openai.GptModelAPI.SendMessageOptions,
  ): Promise<{ messages: Array<openai.GptModelAPI.CompletionRequestMessage>; }> {
    const { systemMessage = this._systemMessage } = options;
    let { parentMessageId } = options;
    // 当前系统和用户消息
    const messages: Array<openai.GptModelAPI.CompletionRequestMessage> = [
      {
        role: 'system',
        content: systemMessage,
      },
      {
        role: 'user',
        content: text,
      },
    ];

    const enableChatRound = this.enableChatRound;
    const chatRound = this.chatRound;

    let messageCount = 0;
    while (true && this._withContent) {
      // TODO this._maxModelTokens 、 this._maxResponseTokens 配合计算当前消息可以输入的最大长度
      if (!parentMessageId) {
        break;
      }
      const parentMessage = await this._getMessageById(parentMessageId);
      if (!parentMessage || (enableChatRound && messageCount >= (2 * chatRound))) {
        break;
      }
      messages.splice(1, 0, {
        role: parentMessage.role,
        content: parentMessage.text,
      });
      parentMessageId = parentMessage.parentMessageId;
      messageCount += 1;
    }

    return { messages };
  }

  /**
   * @desc 获取消息
   * @param {string} id
   * @returns {Promise<ApiResponse | undefined>}
   */
  private async _defaultGetMessageById(
    id: string,
  ): Promise<openai.GptModelAPI.ApiResponse | undefined> {
    const messageOption = await this._messageStore.get(id);
    return messageOption;
  }
  /**
   * @desc 默认更新消息的方法
   * @param {ApiResponse} messageOption
   * @returns {Promise<void>}
   */
  private async _defaultUpsertMessage(
    messageOption: openai.GptModelAPI.ApiResponse,
  ): Promise<boolean> {
    return await this._messageStore.set(messageOption.messageId, messageOption);
  }
  /**
   * @desc 清空消息
   * @returns {Promise<void>}
   */
  public async _clearMessage(): Promise<void> {
    return await this._messageStore.clear();
  }
}
