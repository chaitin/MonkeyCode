import { useState, useEffect, useRef } from "react"
import { InputGroupButton } from "@/components/ui/input-group"
import { IconMicrophone } from "@tabler/icons-react"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import type { DomainSpeechRecognitionEvent } from "@/api/Api"
import React from "react"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"

interface VoiceInputButtonProps {
  disabled?: boolean
  onTextRecognized: (text: string) => void
  className?: string
}

export const VoiceInputButton = ({ disabled = false, className = '', onTextRecognized }: VoiceInputButtonProps) => {
  const { t } = useTranslation()
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioDataRef = useRef<Int16Array[]>([])
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)

  const loadAudioWorklet = async (audioContext: AudioContext): Promise<void> => {
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        process(inputs, outputs) {
          const input = inputs[0]
          if (input && input.length > 0) {
            const inputData = input[0]
            const pcmData = new Int16Array(inputData.length)
            for (let i = 0; i < inputData.length; i++) {
              pcmData[i] = Math.max(-32768, Math.min(32767, Math.ceil(inputData[i] * 32768)))
            }
            this.port.postMessage({ pcmData: pcmData.buffer }, [pcmData.buffer])
          }
          return true
        }
      }
      
      registerProcessor('pcm-processor', PCMProcessor)
    `

    const blob = new Blob([workletCode], { type: 'application/javascript' })
    const workletUrl = URL.createObjectURL(blob)

    try {
      await audioContext.audioWorklet.addModule(workletUrl)
    } finally {
      URL.revokeObjectURL(workletUrl)
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      
      const audioContext = new AudioContext({ sampleRate: 16000 })
      audioContextRef.current = audioContext
      
      await loadAudioWorklet(audioContext)
      
      const sourceNode = audioContext.createMediaStreamSource(stream)
      sourceNodeRef.current = sourceNode
      
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor')
      workletNodeRef.current = workletNode
      
      audioDataRef.current = []
      
      workletNode.port.onmessage = (event) => {
        const { pcmData } = event.data
        if (pcmData) {
          audioDataRef.current.push(new Int16Array(pcmData))
        }
      }
      
      sourceNode.connect(workletNode)
      workletNode.connect(audioContext.destination)
      
      setIsRecording(true)
    } catch (error) {
      console.error('Microphone access failed:', error)
      toast.error(t("taskWorkflow.voice.microphoneDenied"))
    }
  }

  const stopRecording = async () => {
    if (!isRecording || !audioContextRef.current || !workletNodeRef.current) {
      return
    }
    
    setIsRecording(false)
    await new Promise(resolve => setTimeout(resolve, 100))
    
    if (workletNodeRef.current) {
      workletNodeRef.current.port.close()
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect()
      sourceNodeRef.current = null
    }
    
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const totalLength = audioDataRef.current.reduce((sum, chunk) => sum + chunk.length, 0)
    
    if (totalLength > 0) {
      const allData = new Int16Array(totalLength)
      let offset = 0
      for (const chunk of audioDataRef.current) {
        allData.set(chunk, offset)
        offset += chunk.length
      }
      
      const pcmBlob = new Blob([allData.buffer], { type: 'audio/pcm' })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fileName = `recording-${timestamp}.pcm`
      
      setIsProcessing(true)
      try {
        const formData = new FormData()
        const audioFile = new File([pcmBlob], fileName, { type: 'audio/pcm' })
        formData.append('audio', audioFile)
        
        const response = await fetch('/api/v1/users/tasks/speech-to-text', {
          method: 'POST',
          credentials: 'same-origin',
          body: formData,
        })
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent = ''
        
        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim()
              } else if (line.startsWith('data: ')) {
                try {
                  const eventData = JSON.parse(line.slice(6))
                  const event: DomainSpeechRecognitionEvent = {
                    event: currentEvent,
                    data: eventData
                  }
                  
                  if (event.event === 'recognition' && event.data?.type === 'result' && event.data.text) {
                    onTextRecognized(event.data.text)
                  } else if (event.event === 'end' || event.data?.type === 'end') {
                    break
                  } else if (event.event === 'error' || (event.data?.type === 'error' && event.data?.error)) {
                    throw new Error(event.data?.error || t("taskWorkflow.voice.recognitionError"))
                  }
                } catch (e) {
                  console.error('Failed to parse SSE data:', e)
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Speech recognition failed:', error)
        toast.error(t("taskWorkflow.voice.recognitionFailed", {
          message: error instanceof Error ? error.message : t("taskWorkflow.voice.unknownError"),
        }))
      } finally {
        setIsProcessing(false)
      }
      
      audioDataRef.current = []
    }
    
    if (audioContextRef.current) {
      await audioContextRef.current.close()
      audioContextRef.current = null
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return
    }
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!isRecording) {
      startRecording()
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (isRecording) {
      stopRecording()
    }
  }

  const handlePointerCancel = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (isRecording) {
      stopRecording()
    }
  }

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      if (workletNodeRef.current) {
        workletNodeRef.current.port.close()
        workletNodeRef.current.disconnect()
        workletNodeRef.current = null
      }
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect()
        sourceNodeRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error)
        audioContextRef.current = null
      }
    }
  }, [])

  return (
    <InputGroupButton 
      variant={isRecording ? "default" : "outline"} 
      size={isRecording ? "sm" : "icon-sm"} 
      className={cn("cursor-pointer rounded-full", className)}
      disabled={disabled || isProcessing}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {isProcessing ? (
        <Spinner className="size-4" />
      ) : (
        isRecording ? (
          <>
            <IconMicrophone className="" />
            {t("taskWorkflow.voice.recording")}
          </>
        ) : (
          <IconMicrophone />
        )
      )}
    </InputGroupButton>
  )
}
