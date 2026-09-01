import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { PostVisibility } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import TopBar from '@/components/layout/TopBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { toast } from 'sonner'
import { ImagePlus, X, ChevronDown, Globe, Lock, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

const VISIBILITY_OPTIONS: { value: PostVisibility; label: string; icon: typeof Globe }[] = [
  { value: 'public', label: 'Public', icon: Globe },
  { value: 'friends', label: 'Friends Only', icon: Users },
  { value: 'private', label: 'Private', icon: Lock },
]

const MAX_TAGS = 10
const MAX_TAG_LENGTH = 30
const MAX_TITLE = 100
const MAX_DESCRIPTION = 500

function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, ' ').trim()
}

export default function Create() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'select' | 'uploading' | 'compose'>('select')
  const [mediaUrl, setMediaUrl] = useState('')
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image')
  const [posting, setPosting] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<PostVisibility>('public')
  const [isChildFriendly, setIsChildFriendly] = useState(true)
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [postId, setPostId] = useState<string | null>(null)

  const [uploadFile, setUploadFile] = useState<File | null>(null)

  const uploadMedia = async (file: File) => {
    if (!user) {
      toast.error('You must be signed in to create a post')
      return
    }
    const localPreviewUrl = URL.createObjectURL(file)
    const isVideo = file.type.startsWith('video/')
    setMediaUrl(localPreviewUrl)
    setMediaType(isVideo ? 'video' : 'image')
    setUploadFile(file)
    setStep('compose')
  }

  const addTagsFromInput = () => {
    const parts = tagInput.split(',')
    const newTags: string[] = []
    for (const part of parts) {
      const normalized = normalizeTag(part).slice(0, MAX_TAG_LENGTH)
      if (normalized && !tags.includes(normalized) && newTags.length + tags.length < MAX_TAGS) newTags.push(normalized)
    }
    if (newTags.length) setTags([...tags, ...newTags])
    setTagInput('')
  }

  const handleTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTagsFromInput()
    }
  }

  const handlePost = async () => {
    if (!user || !mediaUrl || posting) return
    const finalTags = [...tags]
    const pendingTag = normalizeTag(tagInput).slice(0, MAX_TAG_LENGTH)
    if (pendingTag && !finalTags.includes(pendingTag) && finalTags.length < MAX_TAGS) finalTags.push(pendingTag)
    setTags(finalTags)
    setTagInput('')
    setPosting(true)

    try {
      let finalPublicUrl = mediaUrl

      // If we have a local File object to upload
      if (uploadFile) {
        const isVideo = uploadFile.type.startsWith('video/')
        const folder = isVideo ? 'videos' : 'images'
        const ext = uploadFile.name.split('.').pop()?.toLowerCase() || (isVideo ? 'mp4' : 'jpg')
        const path = folder + '/' + user.id + '-' + Date.now() + '-' + crypto.randomUUID().slice(0, 8) + '.' + ext

        const { error: uploadError } = await supabase.storage
          .from('posts')
          .upload(path, uploadFile, { upsert: true })

        if (uploadError) {
          throw new Error('Storage upload failed: ' + uploadError.message)
        }

        const { data: publicData } = supabase.storage.from('posts').getPublicUrl(path)
        finalPublicUrl = publicData.publicUrl
      }

      // Create or update post
      const nextMediaType = uploadFile ? (uploadFile.type.startsWith('video/') ? 'video' : 'image') : mediaType
      const postPayload = {
        user_id: user.id,
        media_url: finalPublicUrl,
        media_type: nextMediaType,
        title: title.trim(),
        caption: caption.trim(),
        description: description.trim(),
        visibility,
        is_child_friendly: isChildFriendly,
        status: 'published',
        moderation_status: 'safe',
        moderation_result: {},
        publish_requested: true,
        published_at: new Date().toISOString(),
      }

      let createdPostId = postId
      if (createdPostId) {
        const { error: updateError } = await supabase
          .from('posts')
          .update(postPayload)
          .eq('id', createdPostId)
          .eq('user_id', user.id)
        if (updateError) throw updateError
      } else {
        const { data: newPost, error: insertError } = await supabase
          .from('posts')
          .insert(postPayload)
          .select('id')
          .single()
        if (insertError || !newPost) throw insertError || new Error('Could not create post')
        createdPostId = newPost.id
      }

      if (finalTags.length && createdPostId) {
        const { error: tagError } = await supabase
          .from('post_tags')
          .insert(finalTags.map(tag => ({ post_id: createdPostId, tag })))
        if (tagError) toast.error('Post shared, but tags could not be saved')
      }

      toast.success('Post shared!')
      navigate('/')
    } catch (error: unknown) {
      console.error('Create post error:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to share post')
    } finally {
      setPosting(false)
    }
  }

  const resetMedia = () => {
    setMediaUrl('')
    setUploadFile(null)
    setPostId(null)
    setStep('select')
    setTags([])
    setTagInput('')
  }

  return (
    <div className="pb-20">
      <TopBar title="New Post" showBack right={step === 'compose' ? (
        <Button variant="ghost" size="sm" className="font-semibold text-primary" disabled={posting} onClick={handlePost}>
          {posting ? <Spinner className="size-4" /> : 'Share'}
        </Button>
      ) : undefined} />
      <div className="mx-auto max-w-lg px-4 py-4">
        {step === 'select' && (
          <button type="button" className="flex aspect-square w-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border bg-muted/20 transition-colors hover:bg-accent/30" onClick={() => fileRef.current?.click()}>
            <ImagePlus className="size-12 text-muted-foreground" />
            <span className="text-center"><span className="block text-sm font-medium">Tap to upload a photo or video</span><span className="mt-1 block text-xs text-muted-foreground">Share it instantly with your audience</span></span>
          </button>
        )}

        {step === 'uploading' && (
          <div className="relative aspect-square overflow-hidden rounded-2xl bg-muted">
            {mediaType === 'video' ? <video src={mediaUrl} className="size-full object-cover" muted playsInline /> : <img src={mediaUrl} alt="Preview" className="size-full object-cover" />}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/45"><Spinner className="size-10 text-white" /><p className="text-sm font-medium text-white">Uploading...</p></div>
          </div>
        )}

        {step === 'compose' && (
          <>
            <div className="relative aspect-square overflow-hidden rounded-2xl bg-muted shadow-sm">
              {mediaType === 'video' ? <video src={mediaUrl} className="size-full object-cover" controls playsInline /> : <img src={mediaUrl} alt="" className="size-full object-cover" />}
              <button type="button" aria-label="Choose another media" className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur" onClick={resetMedia}><X className="size-4" /></button>
            </div>

            <div className="mt-4 space-y-3">
              <div><Input placeholder="Title" value={title} onChange={event => setTitle(event.target.value.slice(0, MAX_TITLE))} maxLength={MAX_TITLE} /><p className="mt-1 text-right text-xs text-muted-foreground">{title.length}/{MAX_TITLE}</p></div>
              <Textarea placeholder="Write a caption..." value={caption} onChange={event => setCaption(event.target.value)} maxLength={2200} className="min-h-24 resize-none" />
              <Textarea placeholder="Add a description (optional)..." value={description} onChange={event => setDescription(event.target.value.slice(0, MAX_DESCRIPTION))} maxLength={MAX_DESCRIPTION} className="min-h-16 resize-none" />
            </div>

            <Collapsible open={moreOpen} onOpenChange={setMoreOpen} className="mt-4">
              <CollapsibleTrigger asChild><button type="button" className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"><ChevronDown className={cn('size-4 transition-transform', moreOpen && 'rotate-180')} />More Options</button></CollapsibleTrigger>
              <CollapsibleContent className="mt-4 space-y-4">
                <div><p className="mb-2 text-sm font-medium">Is this content suitable for children?</p><div className="flex gap-2"><Button type="button" variant={isChildFriendly ? 'default' : 'outline'} size="sm" onClick={() => setIsChildFriendly(true)}>Yes</Button><Button type="button" variant={!isChildFriendly ? 'default' : 'outline'} size="sm" onClick={() => setIsChildFriendly(false)}>No</Button></div></div>
                <div><p className="mb-2 text-sm font-medium">Who can see this post?</p><div className="flex flex-wrap gap-2">{VISIBILITY_OPTIONS.map(option => { const Icon = option.icon; return <Button type="button" key={option.value} variant={visibility === option.value ? 'default' : 'outline'} size="sm" onClick={() => setVisibility(option.value)}><Icon className="mr-1.5 size-4" />{option.label}</Button> })}</div></div>
                <div><p className="mb-2 text-sm font-medium">Tags</p><Input placeholder="Type a tag and press comma or enter..." value={tagInput} onChange={event => setTagInput(event.target.value)} onKeyDown={handleTagKeyDown} onBlur={addTagsFromInput} maxLength={MAX_TAG_LENGTH} />{tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{tags.map(tag => <Badge key={tag} variant="secondary" className="gap-1">#{tag}<button type="button" aria-label={'Remove ' + tag} onClick={() => setTags(tags.filter(item => item !== tag))}><X className="size-3" /></button></Badge>)}</div>}<p className="mt-1 text-xs text-muted-foreground">{tags.length}/{MAX_TAGS} tags. Separate with commas.</p></div>
              </CollapsibleContent>
            </Collapsible>
            <Button type="button" className="mt-6 w-full" size="lg" disabled={posting} onClick={handlePost}>{posting ? <Spinner className="mr-2 size-4" /> : null}Share Post</Button>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) uploadMedia(file); event.currentTarget.value = '' }} />
      </div>
    </div>
  )
}
