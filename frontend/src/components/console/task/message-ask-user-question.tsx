import { useState, useCallback, useMemo, Fragment, useEffect } from "react"
import type { MessageType } from "./message"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type AskUserQuestionStatus = "pending" | "queued" | "submitting" | "completed" | "expired"

export const AskUserQuestionMessageItem = ({ message, onResponse }: { message: MessageType; onResponse?: (askId: string, answers: Record<string, string | string[]>) => "sent" | "queued" | "rejected" }) => {
  const questions = useMemo(() => message.data.questions || [], [message.data.questions])
  const status = (message.data.status || "pending") as AskUserQuestionStatus
  const isInteractive = status === "pending"
  const [selections, setSelections] = useState<Set<string>[]>(() =>
    Array.from({ length: questions.length }, () => new Set<string>()),
  )
  const [userCustomAnswers, setUserCustomAnswers] = useState<string[]>(() => Array(questions.length).fill(""))

  useEffect(() => {
    const nextSelections = questions.map((question) => {
      if (Array.isArray(question.answer)) {
        return new Set(question.answer)
      }
      if (typeof question.answer === "string" && question.answer !== "") {
        return new Set([question.answer])
      }
      return new Set<string>()
    })

    setSelections(nextSelections)
    setUserCustomAnswers((prev) => questions.map((question, questionIndex) => {
      const optionLabels = question.options.map((option) => option.label)
      if (Array.isArray(question.answer)) {
        return question.answer.find((answer) => !optionLabels.includes(answer)) || ""
      }
      if (typeof question.answer === "string" && !optionLabels.includes(question.answer)) {
        return question.answer
      }
      return prev[questionIndex] || ""
    }))
  }, [questions])

  const updateSelection = useCallback((questionIndex: number, updater: (current: Set<string>) => Set<string>) => {
    setSelections((prev) => {
      const nextSelections = [...prev]
      const current = nextSelections[questionIndex] ? new Set(nextSelections[questionIndex]) : new Set<string>()
      nextSelections[questionIndex] = updater(current)
      return nextSelections
    })
  }, [])

  const handleCheckboxClick = useCallback((questionIndex: number, optionLabel: string, checked: boolean) => {
    updateSelection(questionIndex, (current) => {
      if (checked) {
        current.add(optionLabel)
      } else {
        current.delete(optionLabel)
      }
      return current
    })
  }, [updateSelection])

  const handleRadioClick = useCallback((questionIndex: number, optionLabel: string) => {
    updateSelection(questionIndex, () => new Set([optionLabel]))
  }, [updateSelection])

  const hasUserCustomAnswer = useCallback((questionIndex: number) => {
    const question = questions[questionIndex]
    const options = question?.options.map((option) => option.label) || []
    if (!question) {
      return false
    }

    if (Array.isArray(question.answer)) {
      return question.answer.some((answer) => !options.includes(answer))
    }

    return typeof question.answer === "string" && question.answer !== "" && !options.includes(question.answer)
  }, [questions])

  const userCustomAnswer = useCallback((questionIndex: number) => {
    const question = questions[questionIndex]
    const options = question?.options.map((option) => option.label) || []
    if (!question) {
      return ""
    }

    if (Array.isArray(question.answer)) {
      return question.answer.find((answer) => !options.includes(answer)) || ""
    }

    return typeof question.answer === "string" && !options.includes(question.answer) ? question.answer : ""
  }, [questions])

  const isCheckboxChecked = useCallback((questionIndex: number, optionLabel: string) => {
    return selections[questionIndex]?.has(optionLabel) ?? false
  }, [selections])

  const isAllQuestionsAnswered = useMemo(() => {
    if (questions.length === 0) {
      return false
    }

    return questions.every((_, questionIndex) => {
      const selectedSet = selections[questionIndex]
      if (!selectedSet || selectedSet.size === 0) {
        return false
      }
      if (selectedSet.has("user-custom") && userCustomAnswers[questionIndex].trim() === "") {
        return false
      }
      return true
    })
  }, [questions, selections, userCustomAnswers])

  const handleSubmit = useCallback(() => {
    if (!isInteractive || !onResponse) {
      return
    }

    const answers: Record<string, string | string[]> = {}
    questions.forEach((question, questionIndex) => {
      const selectedSet = selections[questionIndex]
      if (!selectedSet || selectedSet.size === 0) {
        return
      }

      const answerSet = new Set(selectedSet)
      if (answerSet.has("user-custom")) {
        answerSet.delete("user-custom")
        answerSet.add(userCustomAnswers[questionIndex].trim())
      }

      answers[question.question] = question.multiSelect
        ? Array.from(answerSet)
        : answerSet.values().next().value || ""
    })

    onResponse(message.data.askId || "", answers)
  }, [isInteractive, message.data.askId, onResponse, questions, selections, userCustomAnswers])

  const footerText = useMemo(() => {
    switch (status) {
      case "queued":
        return "等待重连后发送"
      case "submitting":
        return "提交中"
      case "completed":
        return "已提交"
      case "expired":
        return "问题已过期"
      default:
        return null
    }
  }, [status])

  return (
    <div className="w-max-[80%] w-[80%] border rounded-md p-2">
      {questions.map((question, questionIndex) => {
        const selectedSet = selections[questionIndex] ?? new Set<string>()
        const selectedRadioValue = selectedSet.values().next().value || ""

        return (
          <Fragment key={questionIndex}>
            <div className="flex flex-col gap-4 p-2">
              <div className="text-sm font-bold">
                {question.question}
              </div>
              {question.multiSelect ? (
                <FieldGroup className="max-w-sm flex flex-wrap gap-2">
                  {question.options.map((option, index) => (
                    <Field orientation="horizontal" key={index}>
                      <Checkbox
                        id={`${message.data.askId}-${questionIndex}-${option.label}`}
                        name={`${message.data.askId}-${questionIndex}-${option.label}`}
                        disabled={!isInteractive}
                        checked={isCheckboxChecked(questionIndex, option.label)}
                        onCheckedChange={(checked) => {
                          handleCheckboxClick(questionIndex, option.label, checked === true)
                        }}
                      />
                      <Label
                        htmlFor={`${message.data.askId}-${questionIndex}-${option.label}`}
                        className={cn("font-normal truncate", (!isInteractive && !isCheckboxChecked(questionIndex, option.label)) ? "text-muted-foreground/50" : "")}
                      >
                        {option.label}
                      </Label>
                    </Field>
                  ))}
                  {isInteractive ? (
                    <>
                      <Field orientation="horizontal">
                        <Checkbox
                          id={`${message.data.askId}-${questionIndex}-user-custom`}
                          name={`${message.data.askId}-${questionIndex}-user-custom`}
                          disabled={!isInteractive}
                          checked={isCheckboxChecked(questionIndex, "user-custom")}
                          onCheckedChange={(checked) => {
                            handleCheckboxClick(questionIndex, "user-custom", checked === true)
                          }}
                        />
                        <Label htmlFor={`${message.data.askId}-${questionIndex}-user-custom`} className="font-normal">
                          其他 - 自定义
                        </Label>
                      </Field>
                      {selectedSet.has("user-custom") && (
                        <Field orientation="horizontal">
                          <Input
                            value={userCustomAnswers[questionIndex] || ""}
                            disabled={!isInteractive}
                            placeholder="请输入其他答案"
                            onChange={(e) => {
                              setUserCustomAnswers((prev) => {
                                const nextAnswers = [...prev]
                                nextAnswers[questionIndex] = e.target.value
                                return nextAnswers
                              })
                            }}
                          />
                        </Field>
                      )}
                    </>
                  ) : hasUserCustomAnswer(questionIndex) ? (
                    <Field orientation="horizontal">
                      <Checkbox
                        id={`${message.data.askId}-${questionIndex}-${question.answer}-user-custom`}
                        name={question.answer?.toString() || ""}
                        checked={true}
                        disabled={true}
                      />
                      <Label
                        htmlFor={`${message.data.askId}-${questionIndex}-${question.answer}-user-custom`}
                        className="font-normal truncate"
                      >
                        {userCustomAnswer(questionIndex)}
                      </Label>
                    </Field>
                  ) : null}
                </FieldGroup>
              ) : (
                <RadioGroup
                  className="max-w-sm flex flex-wrap gap-2"
                  value={selectedRadioValue}
                  onValueChange={(value) => {
                    handleRadioClick(questionIndex, value)
                  }}
                  disabled={!isInteractive}
                >
                  {question.options.map((option, index) => (
                    <Field orientation="horizontal" key={index}>
                      <RadioGroupItem
                        id={`${message.data.askId}-${questionIndex}-${option.label}`}
                        value={option.label}
                      />
                      <FieldLabel
                        htmlFor={`${message.data.askId}-${questionIndex}-${option.label}`}
                        className={cn("font-normal truncate", (!isInteractive && selectedRadioValue !== option.label) ? "text-muted-foreground/50" : "")}
                      >
                        {option.label}
                      </FieldLabel>
                    </Field>
                  ))}
                  {isInteractive ? (
                    <>
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id={`${message.data.askId}-${questionIndex}-user-custom`}
                          value="user-custom"
                        />
                        <FieldLabel htmlFor={`${message.data.askId}-${questionIndex}-user-custom`} className="font-normal">
                          其他 - 自定义
                        </FieldLabel>
                      </Field>
                      {selectedSet.has("user-custom") && (
                        <Field orientation="horizontal">
                          <Input
                            value={userCustomAnswers[questionIndex] || ""}
                            placeholder="请输入其他答案"
                            disabled={!isInteractive}
                            onChange={(e) => {
                              setUserCustomAnswers((prev) => {
                                const nextAnswers = [...prev]
                                nextAnswers[questionIndex] = e.target.value
                                return nextAnswers
                              })
                            }}
                          />
                        </Field>
                      )}
                    </>
                  ) : hasUserCustomAnswer(questionIndex) ? (
                    <Field orientation="horizontal">
                      <RadioGroupItem
                        id={`${message.data.askId}-${questionIndex}-${question.answer}-user-custom`}
                        value={userCustomAnswer(questionIndex)}
                      />
                      <FieldLabel
                        htmlFor={`${message.data.askId}-${questionIndex}-${question.answer}-user-custom`}
                        className="font-normal truncate"
                      >
                        {userCustomAnswer(questionIndex)}
                      </FieldLabel>
                    </Field>
                  ) : null}
                </RadioGroup>
              )}
            </div>
            {questionIndex !== questions.length - 1 && <Separator className="my-2" />}
          </Fragment>
        )
      })}

      {(status !== "pending" || questions.length > 0) && <Separator className="my-2" />}

      {status === "pending" ? (
        <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={handleSubmit} disabled={!isAllQuestionsAnswered}>
          {isAllQuestionsAnswered ? "提交" : "提交 (未完成)"}
        </Button>
      ) : footerText ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">
          {footerText}
        </div>
      ) : null}
    </div>
  )
}
