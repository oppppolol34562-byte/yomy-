import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Message, Profile as ProfileType } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import TopBar from '@/components/layout/TopBar'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Send, ImagePlus, Eye, EyeOff, Lock, Mic, Phone, Video, MoreVertical, Trash2, Volume2, Ban, Square, FileText, Download, Reply, Pencil, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { format, formatDistanceToNow } from 'date-fns'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

type PreviewMedia = { url: string; type: 'image' | 'video'; name: string }
type DeleteMode = 'me' | 'everyone'
const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '👏', '👍']

export default function Chat() {
  const { username } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [otherUser, setOtherUser] = useState<ProfileType | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [reactions, setReactions] = useState<Record<string, string[]>>({})
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [showViewOnce, setShowViewOnce] = useState<PreviewMedia | null>(null)
  const [previewMedia, setPreviewMedia] = useState<PreviewMedia | null>(null)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [viewOnceMode, setViewOnceMode] = useState(false)
  const [canMessage, setCanMessage] = useState(true)
  const [actionMessageId, setActionMessageId] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const swipeStartXRef = useRef<number | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const targetUsername = username || searchParams.get('to')
  const downloadUrl = (url: string, name: string) => url + (url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(name)
  const formatFileSize = (bytes: number | null) => !bytes ? '' : bytes < 1024 ? bytes + ' B' : bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  const attachmentLabel = (message: Message) => message.attachment_name || (message.media_type === 'apk' ? 'Android application' : 'Attachment')

  const fetchOtherUser = useCallback(async () => {
    if (!targetUsername || !user) { setLoading(false); return }
    const { data } = await supabase.from('profiles').select('*').eq('username', targetUsername).maybeSingle()
    setOtherUser(data)
    if (!data || data.id === user.id) { setCanMessage(false); setLoading(false); return }
    const { data: block } = await supabase.from('blocks').select('id').or('and(blocker_id.eq.' + user.id + ',blocked_id.eq.' + data.id + '),and(blocker_id.eq.' + data.id + ',blocked_id.eq.' + user.id + ')').limit(1)
    if (block && block.length > 0) { setCanMessage(false); setLoading(false); return }
    if (data.who_can_message === 'nobody') { setCanMessage(false); return }
    if (data.who_can_message === 'followers') {
      const { data: follow } = await supabase.from('follows').select('id').eq('follower_id', user.id).eq('following_id', data.id).eq('status', 'accepted').maybeSingle()
      setCanMessage(!!follow); return
    }
    setCanMessage(true)
  }, [targetUsername, user])

  const fetchReactions = useCallback(async (ids: string[]) => {
    if (!ids.length) { setReactions({}); return }
    const { data } = await supabase.from('message_reactions').select('message_id, emoji').in('message_id', ids)
    const grouped: Record<string, string[]> = {}
    ;(data || []).forEach((reaction: { message_id: string; emoji: string }) => { grouped[reaction.message_id] = [...(grouped[reaction.message_id] || []), reaction.emoji] })
    setReactions(grouped)
  }, [])

  const fetchMessages = useCallback(async () => {
    if (!user || !otherUser) return
    setLoading(true)
    const { data } = await supabase.from('messages').select('*').or('and(sender_id.eq.' + user.id + ',receiver_id.eq.' + otherUser.id + '),and(sender_id.eq.' + otherUser.id + ',receiver_id.eq.' + user.id + ')').is('deleted_at', null).order('created_at', { ascending: true }).limit(200)
    const visible = (data || []).filter(message => message.sender_id === user.id ? !message.deleted_for_sender : !message.deleted_for_receiver) as Message[]
    const hydrated = await Promise.all(visible.map(async message => {
      if (message.view_once && !message.view_once_opened && message.storage_path) return { ...message, media_url: '' }
      if (!message.storage_path) return message
      const { data: signedData } = await supabase.storage.from('messages').createSignedUrl(message.storage_path, 3600)
      return { ...message, media_url: signedData?.signedUrl || '' }
    }))
    setMessages(hydrated)
    setLoading(false)
    await fetchReactions(hydrated.map(message => message.id))
    const unseen = hydrated.filter(message => message.receiver_id === user.id && !message.is_seen)
    if (unseen.length) await supabase.from('messages').update({ is_seen: true }).in('id', unseen.map(message => message.id))
    const { data: muted } = await supabase.from('muted_chats').select('id').eq('user_id', user.id).eq('muted_user_id', otherUser.id).maybeSingle()
    setIsMuted(!!muted)
  }, [user, otherUser, fetchReactions])

  useEffect(() => { void fetchOtherUser() }, [fetchOtherUser])
  useEffect(() => { if (otherUser) void fetchMessages() }, [otherUser, fetchMessages])
  useEffect(() => {
    if (!user || !otherUser) return
    const channel = supabase.channel('chat-' + otherUser.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'sender_id=eq.' + otherUser.id }, payload => {
        if (payload.new.receiver_id === user.id && !payload.new.deleted_at) void fetchMessages()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'sender_id=eq.' + otherUser.id }, () => void fetchMessages())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, () => void fetchReactions(messages.map(message => message.id)))
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [user, otherUser, fetchMessages, fetchReactions, messages])
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages])

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { toast.error('Voice recording is not supported on this device'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recordingChunksRef.current = []
      recorder.ondataavailable = event => { if (event.data.size > 0) recordingChunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
        setRecording(false); setRecordingSeconds(0)
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size > 0) await uploadMedia(new File([blob], 'voice-' + Date.now() + (blob.type.includes('mp4') ? '.mp4' : '.webm'), { type: blob.type }))
      }
      recorderRef.current = recorder; recorder.start(); setRecording(true); setRecordingSeconds(0)
      recordingTimerRef.current = setInterval(() => setRecordingSeconds(seconds => seconds + 1), 1000)
    } catch (error: unknown) {
      const name = error instanceof DOMException ? error.name : ''
      toast.error(name === 'NotAllowedError' || name === 'SecurityError' ? 'Microphone permission is denied. Enable it in Android Settings and try again.' : error instanceof Error ? error.message : 'Microphone permission is required')
    }
  }
  const stopRecording = () => { if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop() }

  const uploadMedia = async (file: File) => {
    if (!user) return
    if (file.size > 50 * 1024 * 1024) { toast.error('Attachments must be 50 MB or smaller'); return }
    setUploadingMedia(true)
    try {
      const isVideo = file.type.startsWith('video/'); const isAudio = file.type.startsWith('audio/'); const isImage = file.type.startsWith('image/'); const isApk = file.name.toLowerCase().endsWith('.apk') || file.type === 'application/vnd.android.package-archive'
      const mediaType: Message['media_type'] = isAudio ? 'audio' : isVideo ? 'video' : isImage ? 'image' : isApk ? 'apk' : 'document'
      if (mediaType !== 'image' && mediaType !== 'video') setViewOnceMode(false)
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'attachment'
      const path = user.id + '/' + crypto.randomUUID() + '-' + safeName
      const { error: uploadError } = await supabase.storage.from('messages').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
      if (uploadError) throw uploadError
      const { data: publicData } = supabase.storage.from('messages').getPublicUrl(path)
      const sent = await sendMessage('', path, mediaType, file.name, file.size, file.type || 'application/octet-stream', path, publicData.publicUrl)
      if (!sent) throw new Error('Attachment uploaded, but the message could not be saved')
      if (fileRef.current) fileRef.current.value = ''
      toast.success('Attachment sent')
    } catch (error: unknown) { toast.error(error instanceof Error ? error.message : 'Upload failed') }
    finally { setUploadingMedia(false) }
  }

  const sendMessage = async (content?: string, mediaUrl?: string, mediaType?: Message['media_type'], attachmentName?: string, attachmentSize?: number, attachmentMimeType?: string, storagePath?: string, fallbackMediaUrl?: string): Promise<boolean> => {
    if (!user || !otherUser || !canMessage) return false
    const messageContent = content ?? newMessage
    if (!messageContent.trim() && !mediaUrl) return false
    setSending(true)
    try {
      if (editingId) {
        const { data, error } = await supabase.from('messages').update({ content: messageContent.trim(), edited_at: new Date().toISOString() }).eq('id', editingId).eq('sender_id', user.id).select('*').single()
        if (error) throw error
        setMessages(previous => previous.map(message => message.id === editingId ? data as Message : message)); setEditingId(null); setNewMessage('')
      } else {
        const insertPayload: Record<string, unknown> = { sender_id: user.id, receiver_id: otherUser.id, content: messageContent.trim(), media_url: mediaUrl || '', media_type: mediaType || '', attachment_name: attachmentName || null, attachment_size: attachmentSize || null, attachment_mime_type: attachmentMimeType || null, reply_to_id: replyTo?.id || null, is_encrypted: true, view_once: viewOnceMode && !!mediaUrl && (mediaType === 'image' || mediaType === 'video') }
        if (storagePath) insertPayload.storage_path = storagePath
        let { data, error } = await supabase.from('messages').insert(insertPayload).select('*').single()
        if (error && storagePath && (error.code === '42703' || error.message?.toLowerCase().includes('storage_path'))) {
          delete insertPayload.storage_path
          insertPayload.media_url = fallbackMediaUrl || mediaUrl || ''
          const retry = await supabase.from('messages').insert(insertPayload).select('*').single()
          data = retry.data
          error = retry.error
        }
        if (error) throw error
        if (data) {
          if (storagePath) void fetchMessages(); else setMessages(previous => [...previous, data as Message]); setNewMessage(''); setReplyTo(null); setViewOnceMode(false)
          void supabase.functions.invoke('send-message-push', { body: { messageId: data.id, recipientId: otherUser.id } })
        }
      }
      return true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message || 'Unknown error')
      console.error('Failed to send message:', error)
      toast.error('Failed to send: ' + message)
      return false
    }
    finally { setSending(false) }
  }

  const toggleMute = async () => {
    if (!user || !otherUser) return
    if (isMuted) { await supabase.from('muted_chats').delete().eq('user_id', user.id).eq('muted_user_id', otherUser.id); setIsMuted(false); toast.success('Unmuted') }
    else { await supabase.from('muted_chats').insert({ user_id: user.id, muted_user_id: otherUser.id }); setIsMuted(true); toast.success('Muted') }
  }
  const blockUser = async () => {
    if (!user || !otherUser) return
    await supabase.from('blocks').insert({ blocker_id: user.id, blocked_id: otherUser.id }); await supabase.from('follows').delete().or('and(follower_id.eq.' + user.id + ',following_id.eq.' + otherUser.id + '),and(follower_id.eq.' + otherUser.id + ',following_id.eq.' + user.id + ')'); toast.success('User blocked'); navigate('/messages')
  }
  const clearChat = async () => {
    if (!user || !otherUser) return
    await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).or('and(sender_id.eq.' + user.id + ',receiver_id.eq.' + otherUser.id + '),and(sender_id.eq.' + otherUser.id + ',receiver_id.eq.' + user.id + ')'); setMessages([]); toast.success('Chat cleared')
  }
  const openViewOnce = async (message: Message) => {
    if (!user || message.sender_id === user.id || !message.view_once || message.view_once_opened) return
    let { data, error } = await supabase.rpc('open_view_once_message', { p_message_id: message.id })
    if (error && (error.code === '42883' || error.message?.toLowerCase().includes('open_view_once_message'))) {
      const legacy = await supabase.from('messages').update({ view_once_opened: true }).eq('id', message.id).eq('receiver_id', user.id).eq('view_once', true).eq('view_once_opened', false).select('media_url').maybeSingle()
      data = legacy.data ? { opened: true, media_url: legacy.data.media_url } : null
      error = legacy.error
    }
    const opened = data as { opened?: boolean; media_url?: string; storage_path?: string | null } | null
    const mediaPath = opened?.storage_path || opened?.media_url
    if (error || !opened?.opened || !mediaPath) {
      toast.error(error?.message || 'This media has already been opened')
      return
    }
    const { data: signedData, error: signedError } = opened.storage_path ? await supabase.storage.from('messages').createSignedUrl(mediaPath, 60) : { data: null, error: null }
    const mediaUrl = signedData?.signedUrl || (!opened.storage_path ? opened.media_url : '')
    if (signedError || !mediaUrl) {
      toast.error('The media could not be opened')
      return
    }
    setShowViewOnce({ url: mediaUrl, type: message.media_type === 'video' ? 'video' : 'image', name: message.attachment_name || (message.media_type === 'video' ? 'video.mp4' : 'photo.jpg') })
    setMessages(previous => previous.map(item => item.id === message.id ? { ...item, view_once_opened: true } : item))
  }
  const toggleReaction = async (message: Message, emoji: string) => {
    if (!user) return
    const current = reactions[message.id] || []; const hasReaction = current.includes(emoji)
    if (hasReaction) await supabase.from('message_reactions').delete().eq('message_id', message.id).eq('user_id', user.id).eq('emoji', emoji)
    else await supabase.from('message_reactions').upsert({ message_id: message.id, user_id: user.id, emoji }, { onConflict: 'message_id,user_id,emoji' })
    setReactions(previous => ({ ...previous, [message.id]: hasReaction ? current.filter(item => item !== emoji) : [...current, emoji] })); setActionMessageId(null)
  }
  const deleteMessage = async (message: Message, mode: DeleteMode) => {
    if (!user) return
    if (mode === 'everyone') { if (message.sender_id !== user.id) { toast.error('Only the sender can delete for everyone'); return }; await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', message.id).eq('sender_id', user.id) }
    else { const field = message.sender_id === user.id ? 'deleted_for_sender' : 'deleted_for_receiver'; await supabase.from('messages').update({ [field]: true }).eq('id', message.id) }
    setMessages(previous => previous.filter(item => item.id !== message.id)); setSelectedIds(previous => previous.filter(id => id !== message.id)); setActionMessageId(null)
  }
  const deleteSelected = async (mode: DeleteMode) => {
    const selected = messages.filter(message => selectedIds.includes(message.id)); if (!selected.length || !user) return
    if (mode === 'everyone') { const ownIds = selected.filter(message => message.sender_id === user.id).map(message => message.id); if (ownIds.length) await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).in('id', ownIds).eq('sender_id', user.id) }
    else await Promise.all(selected.map(message => supabase.from('messages').update({ [message.sender_id === user.id ? 'deleted_for_sender' : 'deleted_for_receiver']: true }).eq('id', message.id)))
    setMessages(previous => previous.filter(message => !selectedIds.includes(message.id) || (mode === 'everyone' && message.sender_id !== user.id))); setSelectionMode(false); setSelectedIds([])
  }
  const startEdit = (message: Message) => { if (!user || message.sender_id !== user.id || message.media_url) return; setEditingId(message.id); setNewMessage(message.content); setReplyTo(null); setActionMessageId(null) }
  const startPress = (message: Message) => { if (selectionMode) return; if (pressTimerRef.current) clearTimeout(pressTimerRef.current); pressTimerRef.current = setTimeout(() => setActionMessageId(message.id), 500) }
  const endPress = () => { if (pressTimerRef.current) clearTimeout(pressTimerRef.current); pressTimerRef.current = null }
  const toggleSelected = (id: string) => setSelectedIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  useEffect(() => () => { endPress(); if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop() }, [])

  if (!targetUsername) return <div className="flex min-h-screen items-center justify-center"><p className="text-muted-foreground">Select a conversation</p></div>
  if (loading || !otherUser) return <div className="flex min-h-screen items-center justify-center">{loading ? <Spinner className="size-8" /> : <p className="text-muted-foreground">User not found</p>}</div>
  return <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background">
    <TopBar title={selectionMode ? selectedIds.length + ' selected' : ''} showBack right={selectionMode ? <div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={() => void deleteSelected('me')} disabled={!selectedIds.length}><Trash2 className="size-5" /></Button><Button variant="ghost" size="icon" onClick={() => { setSelectionMode(false); setSelectedIds([]) }}><X className="size-5" /></Button></div> : <div className="flex items-center gap-1"><Button variant="ghost" size="icon" className="size-9" onClick={() => toast.info('Voice calls will be available after call signaling is configured.')}><Phone className="size-5" /></Button><Button variant="ghost" size="icon" className="size-9" onClick={() => toast.info('Video calls will be available after call signaling is configured.')}><Video className="size-5" /></Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-9"><MoreVertical className="size-5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void toggleMute()}><Volume2 className="mr-2 size-4" />{isMuted ? 'Unmute' : 'Mute'} notifications</DropdownMenuItem><DropdownMenuItem onClick={() => { setSelectionMode(true); setSelectedIds([]) }}><Check className="mr-2 size-4" />Select messages</DropdownMenuItem><DropdownMenuItem onClick={() => void clearChat()}><Trash2 className="mr-2 size-4" />Clear chat</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => void blockUser()} className="text-destructive focus:text-destructive"><Ban className="mr-2 size-4" />Block user</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>} />
    <Link to={'/profile/' + otherUser.username} className="flex shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-xl hover:bg-accent/30"><Avatar className="size-10"><AvatarImage src={otherUser.avatar_url} /><AvatarFallback>{otherUser.username[0]?.toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><div className="flex items-center gap-1"><p className="text-sm font-semibold">{otherUser.username}</p>{otherUser.is_verified && <span className="text-xs text-blue-500">✓</span>}</div><p className="text-xs text-muted-foreground">{otherUser.is_online ? 'Online' : otherUser.show_last_seen && otherUser.last_seen_at ? 'Last seen ' + formatDistanceToNow(new Date(otherUser.last_seen_at), { addSuffix: true }) : 'Offline'}</p></div><div className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /><span>Encrypted</span></div></Link>
    <div ref={scrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-4 pb-6">{messages.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-3 text-center"><Avatar className="size-20"><AvatarImage src={otherUser.avatar_url} /><AvatarFallback className="text-2xl">{otherUser.username[0]?.toUpperCase()}</AvatarFallback></Avatar><p className="font-semibold">{otherUser.username}</p><Button size="sm" onClick={() => void sendMessage('Hi! 👋')}>Say hello</Button></div> : messages.map((msg, idx) => {
      const isMe = msg.sender_id === user?.id; const previous = messages[idx - 1]; const showDate = !previous || new Date(previous.created_at).toDateString() !== new Date(msg.created_at).toDateString(); const replyMessage = msg.reply_to_id ? messages.find(item => item.id === msg.reply_to_id) : null; const messageReactions = reactions[msg.id] || []
      return <div key={msg.id}>{showDate && <div className="my-3 flex justify-center"><span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{format(new Date(msg.created_at), 'MMM d, yyyy')}</span></div>}<div className={cn('flex', isMe ? 'justify-end' : 'justify-start')}><div className="relative max-w-[84%]"><div className={cn('rounded-2xl px-3 py-2 shadow-sm transition-all', isMe ? 'bg-primary text-primary-foreground' : 'bg-muted', msg.view_once && 'border-2 border-dashed', selectionMode && selectedIds.includes(msg.id) && 'ring-2 ring-cyan-400')} onDoubleClick={() => void toggleReaction(msg, '❤️')} onContextMenu={event => event.preventDefault()} onPointerDown={() => startPress(msg)} onPointerUp={endPress} onPointerCancel={endPress} onTouchStart={event => { swipeStartXRef.current = event.touches[0]?.clientX ?? null }} onTouchEnd={event => { const startX = swipeStartXRef.current; swipeStartXRef.current = null; if (startX !== null && event.changedTouches[0].clientX - startX > 60) { setReplyTo(msg); toast.info('Replying to message') } }} onClick={() => { if (selectionMode) toggleSelected(msg.id) }}>
        {replyMessage && <div className="mb-2 border-l-2 border-current/50 pl-2 text-xs opacity-70"><p className="font-semibold">{replyMessage.sender_id === user?.id ? 'You' : otherUser.username}</p><p className="truncate">{replyMessage.content || (replyMessage.media_type === 'audio' ? 'Voice message' : 'Attachment')}</p></div>}
        {msg.view_once && !msg.view_once_opened && !isMe ? <button type="button" onClick={() => void openViewOnce(msg)} className="flex items-center gap-2"><Eye className="size-4" /><span className="text-sm">{msg.media_type === 'video' ? 'View-once video' : 'View-once photo'}</span></button> : msg.view_once && !msg.view_once_opened && isMe ? <div className="flex items-center gap-2 text-muted-foreground"><Eye className="size-4" /><span className="text-sm italic">View-once media sent</span></div> : msg.view_once && msg.view_once_opened ? <div className="flex items-center gap-2 text-muted-foreground"><EyeOff className="size-4" /><span className="text-sm italic">Media expired</span></div> : <>
          {msg.media_url && msg.media_type === 'image' && <div className="relative mb-1 overflow-hidden rounded-xl"><button type="button" className="block" onClick={() => setPreviewMedia({ url: msg.media_url, type: 'image', name: msg.attachment_name || 'photo.jpg' })}><img src={msg.media_url} alt="" className="max-h-72 max-w-[min(72vw,20rem)] object-cover" /></button><a href={downloadUrl(msg.media_url, msg.attachment_name || 'photo.jpg')} download={msg.attachment_name || 'photo.jpg'} target="_blank" rel="noreferrer" aria-label="Download photo" onClick={event => event.stopPropagation()} className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur"><Download className="size-4" /></a></div>}
          {msg.media_url && msg.media_type === 'video' && <div className="relative mb-1 overflow-hidden rounded-xl"><button type="button" className="block" onClick={() => setPreviewMedia({ url: msg.media_url, type: 'video', name: msg.attachment_name || 'video.mp4' })}><video src={msg.media_url} muted playsInline className="max-h-72 max-w-[min(72vw,20rem)] object-cover" /></button><a href={downloadUrl(msg.media_url, msg.attachment_name || 'video.mp4')} download={msg.attachment_name || 'video.mp4'} target="_blank" rel="noreferrer" aria-label="Download video" onClick={event => event.stopPropagation()} className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur"><Download className="size-4" /></a></div>}
          {msg.media_url && msg.media_type === 'audio' && <div className="flex items-center gap-2 py-1"><Mic className="size-4 shrink-0" /><audio src={msg.media_url} controls className="h-8 max-w-[min(60vw,16rem)]" /></div>}
          {msg.media_url && ['document', 'apk', 'file'].includes(msg.media_type) && <a href={downloadUrl(msg.media_url, attachmentLabel(msg))} download={attachmentLabel(msg)} target="_blank" rel="noreferrer" className="flex min-w-52 items-center gap-3 rounded-xl bg-black/10 px-3 py-2 hover:bg-black/20"><FileText className="size-5 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{attachmentLabel(msg)}</span><span className="block text-xs opacity-70">{msg.media_type === 'apk' ? 'APK' : 'Document'} {formatFileSize(msg.attachment_size)}</span></span><Download className="size-4 shrink-0" /></a>}
          {msg.content && <p className="whitespace-pre-wrap break-words text-sm">{msg.content}</p>}
        </>}
        <div className={cn('mt-1 flex items-center gap-1', isMe ? 'justify-end' : 'justify-start')}><span className="text-[10px] opacity-60">{format(new Date(msg.created_at), 'h:mm a')}{msg.edited_at ? ' · edited' : ''}</span>{isMe && !msg.view_once && <span className="text-[10px] opacity-60">{msg.is_seen ? '✓✓' : '✓'}</span>}</div>
      </div>{messageReactions.length > 0 && <div className={cn('mt-[-5px] flex flex-wrap gap-1', isMe ? 'justify-end' : 'justify-start')}>{Array.from(new Set(messageReactions)).map(emoji => <button type="button" key={emoji} onClick={() => void toggleReaction(msg, emoji)} className="rounded-full border border-border bg-background px-1.5 py-0.5 text-xs shadow-sm">{emoji} {messageReactions.filter(item => item === emoji).length}</button>)}</div>}{actionMessageId === msg.id && !selectionMode && <div className="mt-2 flex flex-wrap items-center gap-1 rounded-2xl border border-border bg-background/95 p-1.5 shadow-xl backdrop-blur"><div className="flex items-center gap-0.5">{REACTION_EMOJIS.map(emoji => <button type="button" key={emoji} onClick={() => void toggleReaction(msg, emoji)} className="flex size-8 items-center justify-center rounded-full text-lg hover:bg-muted">{emoji}</button>)}</div><Button variant="ghost" size="sm" onClick={() => { setReplyTo(msg); setActionMessageId(null) }}><Reply className="mr-1 size-4" />Reply</Button>{isMe && !msg.media_url && !msg.view_once && <Button variant="ghost" size="sm" onClick={() => startEdit(msg)}><Pencil className="mr-1 size-4" />Edit</Button>}<Button variant="ghost" size="sm" onClick={() => void deleteMessage(msg, 'me')}><Trash2 className="mr-1 size-4" />Delete for me</Button>{isMe && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void deleteMessage(msg, 'everyone')}><Trash2 className="mr-1 size-4" />Everyone</Button>}<Button variant="ghost" size="icon" onClick={() => setActionMessageId(null)}><X className="size-4" /></Button></div>}</div></div></div>
    })}</div>

    <div className="shrink-0 border-t border-border bg-background/95 px-3 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl">{replyTo && <div className="mx-auto mb-2 flex max-w-2xl items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs"><Reply className="size-4 shrink-0 text-cyan-400" /><div className="min-w-0 flex-1"><p className="font-semibold">Replying to {replyTo.sender_id === user?.id ? 'yourself' : otherUser.username}</p><p className="truncate text-muted-foreground">{replyTo.content || 'Attachment'}</p></div><Button variant="ghost" size="icon" className="size-7" onClick={() => setReplyTo(null)}><X className="size-4" /></Button></div>}{editingId && <div className="mx-auto mb-2 flex max-w-2xl items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs"><Pencil className="size-4 shrink-0 text-violet-400" /><span className="flex-1">Editing message</span><Button variant="ghost" size="icon" className="size-7" onClick={() => { setEditingId(null); setNewMessage('') }}><X className="size-4" /></Button></div>}{!canMessage ? <p className="mx-auto text-center text-sm text-muted-foreground">{otherUser.username} only accepts messages from approved followers.</p> : <div className="mx-auto flex w-full max-w-2xl items-center gap-2"><input ref={fileRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.apk,application/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadMedia(file) }} /><Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => fileRef.current?.click()} disabled={uploadingMedia || sending}><ImagePlus className="size-5" /></Button><Button variant="ghost" size="icon" className={cn('relative size-9 shrink-0', viewOnceMode ? 'bg-primary/20 text-primary ring-2 ring-primary' : 'text-muted-foreground')} aria-pressed={viewOnceMode} title={viewOnceMode ? 'View once: ON' : 'View once: OFF'} onClick={() => { setViewOnceMode(!viewOnceMode); toast.info(viewOnceMode ? 'View-once off' : 'View-once on') }} disabled={uploadingMedia}><Eye className="size-5" />{viewOnceMode && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[8px] font-bold text-primary-foreground">1x</span>}</Button><Button variant="ghost" size="icon" className={cn('size-9 shrink-0', recording && 'animate-pulse text-red-500')} onClick={recording ? stopRecording : startRecording} disabled={uploadingMedia || sending}>{recording ? <><Square className="size-4 fill-current" /><span className="sr-only">Recording {recordingSeconds} seconds</span></> : <Mic className="size-5" />}</Button><Input placeholder={editingId ? 'Edit message...' : 'Message...'} value={newMessage} onChange={event => setNewMessage(event.target.value)} onKeyDown={event => event.key === 'Enter' && !sending && void sendMessage()} className="flex-1" disabled={sending} /><Button size="icon" className="size-9 shrink-0" disabled={(!newMessage.trim() && !editingId) || sending} onClick={() => void sendMessage()}>{sending ? <Spinner className="size-4" /> : <Send className="size-4" />}</Button></div>}</div>

    {showViewOnce && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black" onClick={() => setShowViewOnce(null)}>{showViewOnce.type === 'video' ? <video src={showViewOnce.url} autoPlay controls playsInline className="max-h-full max-w-full object-contain" /> : <img src={showViewOnce.url} alt="" className="max-h-full max-w-full object-contain" />}<Button variant="ghost" className="absolute right-4 top-4 text-white" size="icon" onClick={() => setShowViewOnce(null)}><X className="size-6" /></Button></div>}
    {previewMedia && <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-4" onClick={() => setPreviewMedia(null)}><div className="flex w-full max-w-3xl justify-end pb-3"><Button variant="ghost" size="icon" className="text-white" onClick={() => setPreviewMedia(null)}><X className="size-6" /></Button></div><div className="flex min-h-0 max-h-[78vh] w-full items-center justify-center" onClick={event => event.stopPropagation()}>{previewMedia.type === 'video' ? <video src={previewMedia.url} controls autoPlay playsInline className="max-h-[78vh] max-w-full rounded-xl" /> : <img src={previewMedia.url} alt="" className="max-h-[78vh] max-w-full rounded-xl object-contain" />}</div><a href={downloadUrl(previewMedia.url, previewMedia.name)} download={previewMedia.name} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black"><Download className="size-4" />Download</a></div>}
  </div>
}
