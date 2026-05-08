...existing content before the AiDraftButton line...

            <div className="px-4 py-3 border-t border-gray-200">
              {chatDetail && <AiDraftButton chatId={selectedChatId!} messages={(chatDetail.messages ?? []).map((m: any) => ({ direction: m.direction, messageType: m.messageType, content: m.content, meta: m.meta }))} onSelect={handleDraftSelect} />}
              {<QuickReplyTemplates onSelect={(text: string) => setMessageContent(text)} />}
              <div className="flex items-center gap-2 mt-2"><input type="text" value={messageContent} onChange={(e) => setMessageContent(e.target.value)} onKeyDown={handleKeyDown} placeholder="メッセージを入力..." className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500" /><button onClick={handleSendMessage} disabled={sending || !messageContent.trim()} className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50" style={{ backgroundColor: '#06C755' }}>{sending ? '...' : '送信'}</button></div>
            </div>

...rest of content...