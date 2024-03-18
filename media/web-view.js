window.onload = function () {
  const vscode = acquireVsCodeApi();
  marked.setOptions({
    renderer: new marked.Renderer(),
    highlight: function (code, _lang) {
      return hljs.highlightAuto(code).value;
    },
    langPrefix: 'hljs language-',
    pedantic: false,
    gfm: true,
    breaks: true,
    sanitize: false,
    smartypants: false,
    xhtml: false,
  });
  // 拿到所有的 需要操作的 dom
  const questionInputElement = document.getElementById('question-input');
  const answerListElement = document.getElementById('answer-list');
  const stopAskingButtonElement = document.getElementById('stop-generating-button');
  const inProgressElement = document.getElementById('in-progress');
  const questionInputButtons = document.getElementById('question-input-buttons');
  const introductionElement = document.getElementById('introduction');
  const conversationElement = document.getElementById('conversation-list');
  const chatButtonWrapperElement = document.getElementById('chat-button-wrapper');
  const commandListElement = document.getElementById('commandList');

  // 接收来自 webview 的消息
  window.addEventListener('message', (event) => {
    const messageOption = event.data;
    switch (messageOption.type) {
      case 'show-in-progress':
        handleShowInProgress(messageOption);
        break;
      // 添加用户消息
      case 'add-question':
        handleAddQuestion(messageOption);
        break;
      // 添加 gpt 回答
      case 'add-answer':
        handleAddAnswer(messageOption);
        break;
      // 添加错误消息
      case 'add-error':
        handleAddError(messageOption);
        break;
      // 清空会话
      case 'clear-conversation':
        handleClearConversation();
        break;
      // 导出会话
      case 'export-conversation':
        handleExportConversation();
        break;
      // 接受vscode 配置
      case 'set-chatgpt-config':
        chatgpt = messageOption.value;
        break;
      default:
        break;
    }
  });

  const postMessageToVscode = (messageOption) => {
    vscode.postMessage(messageOption);
  };
  // 发送问题
  const handleSendQuestion = () => {
    if (questionInputElement.value?.length > 0) {
      postMessageToVscode({
        type: 'add-question',
        value: questionInputElement.value,
      });
      questionInputElement.value = '';
      setTimeout(() => {
        // 不生效 ？？？
        questionInputElement.rows = 1;
      }, 100);
    }
  };
  // 添加进行中的提示
  const handleShowInProgress = (messageOption) => {
    if (messageOption.showStopButton) {
      // 让停止按钮显示
      stopAskingButtonElement.classList.remove('hidden');
    } else {
      // 让停止按钮隐藏
      stopAskingButtonElement.classList.add('hidden');
    }
    if (messageOption.inProgress) {
      // 让正在进行中的提示显示
      inProgressElement.classList.remove('hidden');
      // 让输入框不可用
      questionInputElement.setAttribute('disabled', true);
      // 让输入框的按钮隐藏
      questionInputButtons.classList.add('hidden');
    } else {
      // 让正在进行中的提示隐藏
      inProgressElement.classList.add('hidden');
      // 让输入框可用
      questionInputElement.removeAttribute('disabled');
      // 让输入框的按钮显示
      questionInputButtons.classList.remove('hidden');
    }
  };
  // 添加用户消息
  const handleAddQuestion = (messageOption) => {
    answerListElement.classList.remove('hidden');
    // 整体介绍隐藏
    introductionElement?.classList?.add('hidden');
    // 让对话列表隐藏
    conversationElement.classList.add('hidden');
    const escapeHtml = (unsafe) => {
      return unsafe
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    };
    answerListElement.innerHTML +=
      `<div class="p-4 self-end mt-2 question-element relative input-background">
                        <h3 class="mb-5 mt-0 flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="mr-2 w-4 h-4">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          You
                        </h3>
                        <no-export class="mb-2 flex items-center">
                            <!-- 重新编辑按钮 -->
                            <button title="` +
      dictionary['chatgpt.webview.editButtonTitle'] +
      `" id="edit-button" class="p-1.5 flex items-center rounded-lg absolute right-6 top-6">
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                              </svg>
                            </button>
                            <div class="hidden send-cancel-container flex gap-2">
                                <button title="` +
      dictionary['chatgpt.webview.sendButtonTitle'] +
      `" id="send-button" class="send-button p-1 pr-2 flex items-center rounded-md">
                                <!-- 发送按钮 -->  
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3 mr-1">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                                  </svg>
                                  ` +
      dictionary['chatgpt.webview.sendButtonName'] +
      `
                                </button>
                                <button title="` +
      dictionary['chatgpt.webview.cancelButtonTitle'] +
      `" id="cancel-button" class="cancel-button p-1 pr-2 flex items-center rounded-md">
                                <!-- 取消按钮 -->   
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3 mr-1">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                                  </svg>
                                  ` +
      dictionary['chatgpt.webview.cancelButtonName'] +
      `
                                </button>
                            </div>
                        </no-export>
                        <div class="overflow-y-auto pt-1 pb-1 pl-3 pr-3 rounded-md">${escapeHtml(
                          messageOption.value,
                        )}</div>
        </div>`;
    if (messageOption.autoScroll) {
      answerListElement.lastChild?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
        inline: 'nearest',
      });
    }
  };
  // 添加错误消息
  const handleAddAnswer = (messageOption) => {
    // 如果存在现有消息
    let existingMessageElement = messageOption.id && document.getElementById(messageOption.id);
    const updatedValue =
      messageOption.value.split('```').length % 2 === 1
        ? messageOption.value
        : messageOption.value + '\n\n```\n\n';

    const markedResponse = marked.parse(updatedValue);
    if (existingMessageElement) {
      // 更新现有消息
      existingMessageElement.innerHTML = markedResponse;
    } else {
      // 第一次回答
      answerListElement.innerHTML += `<div class="p-4 self-end mt-4 pb-8 answer-element">
          <h3 class="mb-5 flex items-center">
            <svg width="20px" height="20px" viewBox="0 0 20 20" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
                <title>AI-logo</title>
                <g id="页面-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
                    <g id="Apple-TV-4K" transform="translate(-3633.000000, -2394.000000)" fill="#FFFFFF">
                        <g id="编组-4" transform="translate(3633.000000, 2394.000000)">
                            <path d="M4.64119579,4.55695986 L9.93472553,8.24854575 L7.90523374,9.26874513 C7.54666722,9.4489919 7.15367018,9.44767214 6.89225895,9.26534337 L5.28207568,8.14227481 C5.12446842,8.03234711 4.86414635,8.0849971 4.70063006,8.25987186 C4.64523904,8.31911055 4.60593582,8.38760745 4.58718737,8.45757762 L3.72640414,11.6700644 L9.59936309,8.71776737 C9.95792623,8.53752009 10.350921,8.53883607 10.6123341,8.72115939 L14.6418437,11.5315521 L12.6123904,12.5517478 C12.2538248,12.7319969 11.8608269,12.7306801 11.5994135,12.5483535 L9.90374077,11.365682 C9.64232658,11.1833549 9.24932716,11.1820387 8.89076078,11.3622893 L0.250290344,15.7058368 L3.0429891,5.28218172 C3.17028512,4.8071065 3.68415762,4.42335764 4.19075544,4.42504904 C4.36234779,4.42562944 4.51840561,4.47132881 4.64119579,4.55695986 Z M18.702,6.4299215 L16.2041345,15.7534514 L16.2085114,15.7535035 L16.2031359,15.7592756 L14.5647869,14.616571 C14.3284011,14.4516983 14.2351905,14.163228 14.3182006,13.8534303 L15.8024929,8.31850727 C15.885664,8.00890403 16.1330777,7.72182954 16.4571165,7.55894673 L18.702,6.4299215 Z M13.9421074,6.96189477 L15.4928479,8.04346139 L13.0201115,9.28653552 C12.6615427,9.46679236 12.2685374,9.4654791 12.0071196,9.28315055 L10.5275445,8.25120538 L13.097964,6.95906893 C13.3967667,6.80886236 13.7242628,6.80995868 13.9421074,6.96189477 Z M19.7511534,2.8137441 L19.176057,4.96015392 C19.0930437,5.26996368 18.8455395,5.55730594 18.5212856,5.72030055 L16.2747054,6.8496023 L16.849832,4.70320047 C16.932843,4.39339927 17.180343,4.10606764 17.5045853,3.94307391 L19.7511534,2.8137441 Z" id="形状"></path>
                        </g>
                    </g>
                </g>
            </svg>
            ChatGPT
          </h3>
          <div class="result-streaming" id="${messageOption.id}">${markedResponse}</div>
      </div>`;
    }
    // 回答完毕
    if (messageOption.done) {
      const preCodeList = answerListElement.lastChild.querySelectorAll('pre > code');
      preCodeList.forEach((preCode) => {
        preCode.classList.add(
          'input-background',
          'p-4',
          'pb-2',
          'block',
          'whitespace-pre',
          'overflow-x-scroll',
        );
        preCode.parentElement.classList.add('pre-code-element', 'relative');
        const buttonWrapper = document.createElement('no-export');
        buttonWrapper.classList.add(
          'code-actions-wrapper',
          'flex',
          'gap-3',
          'pr-2',
          'pt-1',
          'pb-1',
          'flex-wrap',
          'items-center',
          'justify-end',
          'rounded-t-lg',
          'input-background',
        );
        // 复制按钮
        const copyButton = document.createElement('button');

        copyButton.title = dictionary['chatgpt.webview.copyButtonTitle'];
        copyButton.innerHTML =
          `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="mr-1 w-3 h-3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
        </svg>
         ` + dictionary['chatgpt.webview.copyButtonName'];
        copyButton.id = 'copy-button';
        copyButton.classList.add('p-1', 'pr-2', 'flex', 'items-center', 'rounded-lg');
        //  插入按钮
        const insertButton = document.createElement('button');
        insertButton.title = dictionary['chatgpt.webview.insertButtonTitle'];
        insertButton.innerHTML =
          `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="mr-2 w-3 h-3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
        </svg>
        ` + dictionary['chatgpt.webview.insertButtonName'];
        insertButton.id = 'insert-button';
        insertButton.classList.add('p-1', 'pr-2', 'flex', 'items-center', 'rounded-lg');
        // 右侧content 新开tab按钮
        const newTabButton = document.createElement('button');
        newTabButton.title = dictionary['chatgpt.webview.newTabButtonTitle'];
        newTabButton.innerHTML =
          `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="mr-1 w-3 h-3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          ` + dictionary['chatgpt.webview.newTabButtonName'];
        newTabButton.id = 'new-tab-button';
        newTabButton.classList.add('p-1', 'pr-2', 'flex', 'items-center', 'rounded-lg');
        buttonWrapper.append(copyButton, insertButton, newTabButton);
        // previousSibling 方法是用于获取一个节点的前一个同级节点，返回它的前一个同级元素节点（距离当前节点最近的上一个元素节点），如果不存在则返回 null。
        if (preCode.parentNode.previousSibling) {
          preCode.parentNode.parentNode.insertBefore(
            buttonWrapper,
            preCode.parentNode.previousSibling,
          );
        } else {
          preCode.parentNode.parentNode.prepend(buttonWrapper);
        }
      });

      existingMessageElement = document.getElementById(messageOption.id);
      if (existingMessageElement) {
        // 拿掉光标
        existingMessageElement.classList.remove('result-streaming');
      }
    }
    // 如果用户开启了自动滚动 或者 回答完毕 的时候 将页面滚动到底部
    if (messageOption.autoScroll && (messageOption.done || markedResponse.endsWith('\n'))) {
      answerListElement.lastChild?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
        inline: 'nearest',
      });
    }
  };
  // 添加错误消息
  const handleAddError = (messageOption) => {
    if (!answerListElement.innerHTML) {
      return;
    }
    const messageValue = messageOption.value;
    answerListElement.innerHTML += `<div class="p-4 self-end mt-4 pb-8 error-element-ext">
                        <h2 class="mb-5 flex items-center">
                          <svg width="20px" height="20px" viewBox="0 0 20 20" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
                              <title>AI-logo</title>
                              <g id="页面-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
                                  <g id="Apple-TV-4K" transform="translate(-3633.000000, -2394.000000)" fill="#FFFFFF">
                                      <g id="编组-4" transform="translate(3633.000000, 2394.000000)">
                                          <path d="M4.64119579,4.55695986 L9.93472553,8.24854575 L7.90523374,9.26874513 C7.54666722,9.4489919 7.15367018,9.44767214 6.89225895,9.26534337 L5.28207568,8.14227481 C5.12446842,8.03234711 4.86414635,8.0849971 4.70063006,8.25987186 C4.64523904,8.31911055 4.60593582,8.38760745 4.58718737,8.45757762 L3.72640414,11.6700644 L9.59936309,8.71776737 C9.95792623,8.53752009 10.350921,8.53883607 10.6123341,8.72115939 L14.6418437,11.5315521 L12.6123904,12.5517478 C12.2538248,12.7319969 11.8608269,12.7306801 11.5994135,12.5483535 L9.90374077,11.365682 C9.64232658,11.1833549 9.24932716,11.1820387 8.89076078,11.3622893 L0.250290344,15.7058368 L3.0429891,5.28218172 C3.17028512,4.8071065 3.68415762,4.42335764 4.19075544,4.42504904 C4.36234779,4.42562944 4.51840561,4.47132881 4.64119579,4.55695986 Z M18.702,6.4299215 L16.2041345,15.7534514 L16.2085114,15.7535035 L16.2031359,15.7592756 L14.5647869,14.616571 C14.3284011,14.4516983 14.2351905,14.163228 14.3182006,13.8534303 L15.8024929,8.31850727 C15.885664,8.00890403 16.1330777,7.72182954 16.4571165,7.55894673 L18.702,6.4299215 Z M13.9421074,6.96189477 L15.4928479,8.04346139 L13.0201115,9.28653552 C12.6615427,9.46679236 12.2685374,9.4654791 12.0071196,9.28315055 L10.5275445,8.25120538 L13.097964,6.95906893 C13.3967667,6.80886236 13.7242628,6.80995868 13.9421074,6.96189477 Z M19.7511534,2.8137441 L19.176057,4.96015392 C19.0930437,5.26996368 18.8455395,5.55730594 18.5212856,5.72030055 L16.2747054,6.8496023 L16.849832,4.70320047 C16.932843,4.39339927 17.180343,4.10606764 17.5045853,3.94307391 L19.7511534,2.8137441 Z" id="形状"></path>
                                      </g>
                                  </g>
                              </g>
                          </svg>
                          ChatGPT
                        </h2>
                        <div class="text-red-400">${marked.parse(messageValue)}</div>
                    </div>`;
    if (messageOption.autoScroll) {
      answerListElement.lastChild?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
        inline: 'nearest',
      });
    }
  };

  // 清空聊天记录
  const handleClearConversation = () => {
    // 置空问题目录
    answerListElement.innerHTML = '';
    // 显示主题页
    introductionElement?.classList?.remove('hidden');
    postMessageToVscode({
      type: 'clear-conversation',
    });
  };

  // 导出聊天记录
  const handleExportConversation = () => {
    const turndownService = new TurndownService({ codeBlockStyle: 'fenced' });
    turndownService.remove('no-export');
    const markdownContent = turndownService.turndown(answerListElement);
    postMessageToVscode({
      type: 'open-newtab',
      value: markdownContent,
      language: 'markdown',
    });
  };
  // 点击复制按钮
  const handleClickCopyButton = (targetElement) => {
    navigator.clipboard
      .writeText(targetElement.parentElement?.nextElementSibling?.lastChild?.textContent)
      .then(() => {
        targetElement.innerHTML =
          `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="mr-1 w-3 h-3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        ` + dictionary['chatgpt.webview.copiedButtonName'];
        targetElement.title = dictionary['chatgpt.webview.copiedButtonTitle'];
        setTimeout(() => {
          // 恢复按钮
          targetElement.innerHTML =
            `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="mr-1 w-3 h-3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
          </svg>
          ` + dictionary['chatgpt.webview.copyButtonName'];
          targetElement.title = dictionary['chatgpt.webview.copyButtonTitle'];
        }, 1500);
      });
  };
  // 点击插入按钮
  const handleClcikInsertButton = (targetElement) => {
    postMessageToVscode({
      type: 'insert-code',
      value: targetElement.parentElement?.nextElementSibling?.lastChild?.textContent,
    });
  };
  // 点击新开tab按钮
  const handleClickNewTabButton = (targetElement) => {
    postMessageToVscode({
      type: 'open-newtab',
      value: targetElement.parentElement?.nextElementSibling?.lastChild?.textContent,
    });
  };
  // 点击编辑按钮
  const handleClickEditButton = (targetElement) => {
    // 获取到当前的问题元素
    const questionEelemet = targetElement.closest('.question-element');
    // 获取到当前的问题元素的父元素
    const targetButtonParent = targetElement.nextElementSibling;
    targetButtonParent.classList.remove('hidden');
    questionEelemet.lastElementChild?.setAttribute('contenteditable', true);
    targetElement.classList.add('hidden');
  };
  // 点击重发按钮
  const handleClickSendButton = (targetElement) => {
    const questionElement = targetElement.closest('.question-element');
    const sendAndCancelContainer = targetElement.closest('.send-cancel-container');
    const resendElement = targetElement.parentElement.parentElement.firstElementChild;
    sendAndCancelContainer.classList.add('hidden');
    resendElement.classList.remove('hidden');
    questionElement.lastElementChild?.setAttribute('contenteditable', false);
    if (questionElement.lastElementChild.textContent?.length > 0) {
      postMessageToVscode({
        type: 'add-question',
        value: questionElement.lastElementChild.textContent,
      });
    }
  };
  // 点击取消按钮
  const handleClickCancelButton = (targetElement) => {
    const questionElement = targetElement.closest('.question-element');
    const sendAndCancelContainer = targetElement.closest('.send-cancel-container');
    const resendElement = targetElement.parentElement.parentElement.firstElementChild;
    sendAndCancelContainer.classList.add('hidden');
    resendElement.classList.remove('hidden');
    questionElement.lastElementChild?.setAttribute('contenteditable', false);
  };

  // 监听输入框的回车事件
  questionInputElement.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      if (currentCommandIndex !== -1) {
        event.preventDefault();
        var commandItems = commandListElement.querySelectorAll('div');
        let commandItemKey = commandItems[currentCommandIndex].innerText;
        // 隐藏命令列表
        commandListElement.style.display = 'none';
        // 清空输入框中的输入
        questionInputElement.value = '';
        // 执行命令
        supportedCommands[commandItemKey]();
      } else {
        event.preventDefault();
        handleSendQuestion();
      }
    }
  });

  //  给整个webview添加点击事件
  document.addEventListener('click', (e) => {
    // 阻止默认事件
    e.preventDefault();
    const targetElement = e.target.closest('button');
    // 点击更多按钮
    if (targetElement?.id === 'more-button') {
      chatButtonWrapperElement?.classList.toggle('hidden');
      return;
    } else {
      chatButtonWrapperElement?.classList.add('hidden');
    }

    // 点击更新apikey按钮
    if (targetElement?.id === 'update-key-button') {
      postMessageToVscode({
        type: 'update-key',
      });
      return;
    }
    // 点击设置按钮
    if (
      targetElement?.id === 'update-settings-button' ||
      e.target.id === 'update-settings-button'
    ) {
      postMessageToVscode({
        type: 'open-settings',
      });
      return;
    }
    // 点击设置提示按钮
    if (
      targetElement?.id === 'settings-prompt-button' ||
      e.target.id === 'settings-prompt-button'
    ) {
      postMessageToVscode({
        type: 'open-prompt-settings',
      });
      return;
    }
    // 点击提交问题按钮
    if (targetElement?.id === 'submit-question-button') {
      handleSendQuestion();
      return;
    }
    // 点击清除对话按钮
    if (targetElement?.id === 'clear-conversation-button') {
      handleClearConversation();
      return;
    }
    // 点击导出对话按钮
    if (targetElement?.id === 'export-conversation-button') {
      handleExportConversation();
      return;
    }
    // 点击停止回答按钮
    if (targetElement?.id === 'stop-generating-button') {
      postMessageToVscode({
        type: 'stop-generating',
      });
      return;
    }
    // 点击编辑按钮
    if (targetElement?.id === 'edit-button') {
      handleClickEditButton(targetElement);
      return;
    }
    // 点击重发按钮
    if (targetElement?.id === 'send-button') {
      handleClickSendButton(targetElement);
      return;
    }
    // 点击取消按钮
    if (targetElement?.id === 'cancel-button') {
      handleClickCancelButton(targetElement);
      return;
    }

    // 点击复制按钮
    if (targetElement?.id === 'copy-button') {
      handleClickCopyButton(targetElement);
      return;
    }
    // 点击插入按钮
    if (targetElement?.id === 'insert-button') {
      handleClcikInsertButton(targetElement);
      return;
    }
    // 点击新标签按钮
    if (targetElement?.id === 'new-tab-button') {
      handleClickNewTabButton(targetElement);
      return;
    }
  });

  // ---------------------> command in chat area --------------------->
  // 指令功能，解释框选代码
  const handleExplainCode = () => {
    postMessageToVscode({
      type: 'explain-code',
    });
  };
  // 指令功能，find bugs
  const handleFindBugs = () => {
    postMessageToVscode({
      type: 'find-bugs',
    });
  };
  // 指令功能，注释框选代码
  const handleCommentCode = () => {
    postMessageToVscode({
      type: 'comment-code',
    });
  };
  // 支持的指令列表以及命令动作
  const supportedCommands = {
    '/clear content': function () {
      handleClearConversation();
    },
    '/explain code': function () {
      handleExplainCode();
    },
    '/find bugs': function () {
      handleFindBugs();
    },
    '/comment code': function () {
      handleCommentCode();
    },
  };

  // 更新命令列表的函数
  function updateCommandList() {
    console.log('updateCommandList');
    const textarea = questionInputElement;
    const commandText = textarea.value.trim();

    // 只有在输入了"/"并且不是空字符串时才显示列表
    commandListElement.style.display = 'none'; // 隐藏命令列表
    if (commandText.startsWith('/')) {
      // commandList.style.display = 'block';
      commandListElement.innerHTML = ''; // 清空之前的命令列表)

      // 构建命令列表
      for (const [command, callback] of Object.entries(supportedCommands)) {
        // 仅显示前缀匹配命中的命令
        if (!command.startsWith(commandText)) {
          continue;
        }

        const item = document.createElement('div');
        item.classList.add('commandItem');
        item.textContent = command;
        item.onclick = function () {
          textarea.value = ''; // 清空textarea
          callback(); // 执行选中的命令
          commandListElement.style.display = 'none'; // 隐藏命令列表
        };
        commandListElement.appendChild(item);
        commandListElement.style.display = 'block'; // 隐藏命令列表
      }
    }

    // 设置commandList的宽度与commandText相同
    commandListElement.style.width = textarea.scrollWidth + 'px';
  }

  // 监听textarea的input事件以动态更新命令列表
  questionInputElement.addEventListener('input', updateCommandList);

  // 点击文档其他地方隐藏命令列表
  document.body.addEventListener('click', function (event) {
    // 检查点击事件是否发生在commandList之外
    if (!event.target.matches('#commandList')) {
      commandListElement.style.display = 'none'; // 隐藏命令列表
    }
  });

  currentCommandIndex = -1;
  // 设置通过方向键切换选择命令
  document.addEventListener('keydown', function (event) {
    // 使用后代选择器获取commandList下面的所有div元素
    var commandItems = commandListElement.querySelectorAll('div');
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (currentCommandIndex < commandItems.length - 1) {
        currentCommandIndex = currentCommandIndex + 1;
      } else {
        currentCommandIndex = 0;
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (currentCommandIndex > 0) {
        currentCommandIndex = currentCommandIndex - 1;
      } else {
        currentCommandIndex = commandItems.length - 1;
      }
    } else {
      currentCommandIndex = -1;
    }

    for (let commandItem of commandItems) {
      commandItem.classList.remove('commandItemHover');
    }
    if (currentCommandIndex !== -1) {
      commandItems[currentCommandIndex].classList.add('commandItemHover');
    }
  });
  // <---------------------- command in chat area <----------------------
};
