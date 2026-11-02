package exams

import (
	"strings"
	"testing"
)

func TestPublishRefusesUnreadableObjectiveKeys(t *testing.T) {
	content := `{
		"reading": {
			"passages": [{
				"blocks": [
					{"id":"b1","type":"CLOZE","questions":[{"id":"q1","prompt":"One","correctAnswer":"first"}]},
					{"id":"b2","type":"MATCHING","questions":[{"id":"q2","paragraphLabel":"C"}]}
				]
			}]
		}
	}`
	err := validateObjectiveKeysForPublish(ProviderIELTS, content)
	if err == nil {
		t.Fatal("publish accepted an objective question with no readable key")
	}
	message := err.Error()
	if !strings.Contains(message, "Reading question 2") || !strings.Contains(message, "q2") {
		t.Fatalf("error does not name section, number and question: %s", message)
	}
}

func TestPublishRefusesChooseNWithNoCorrectOptions(t *testing.T) {
	content := `{
		"reading": {
			"passages": [{
				"blocks": [
					{"id":"multi","type":"MULTI_MCQ","options":[
						{"id":"o1","isCorrect":false},
						{"id":"o2","isCorrect":false}
					]}
				]
			}]
		}
	}`
	err := validateObjectiveKeysForPublish(ProviderIELTS, content)
	if err == nil {
		t.Fatal("publish accepted a choose-N block with zero correct options")
	}
	if !strings.Contains(err.Error(), "no options marked correct") {
		t.Fatalf("unexpected error: %s", err.Error())
	}
}

func TestPublishAcceptsEveryReadableKeyType(t *testing.T) {
	content := `{
		"reading": {
			"passages": [{
				"blocks": [
					{"id":"b1","type":"TFNG","questions":[{"id":"q1","correctAnswer":"T"}]},
					{"id":"b2","type":"CLOZE","questions":[{"id":"q2","acceptedAnswers":["colour","color"]}]},
					{"id":"b3","type":"MATCHING","questions":[{"id":"q3","correctHeading":"H2"}]},
					{"id":"b4","type":"MAP","questions":[{"id":"q4","correctAnswer":"north"}]},
					{"id":"b5","type":"SHORT_ANSWER","questions":[{"id":"q5","correctAnswer":"answer"}]},
					{"id":"b6","type":"SENTENCE_COMPLETION","questions":[{"id":"q6","blanks":[{"id":"b6a","correctAnswer":"alpha"}]}]},
					{"id":"b7","type":"NOTE_COMPLETION","questions":[{"id":"q7","blanks":[{"id":"b7a","correctAnswer":"note"}]}]},
					{"id":"b8","type":"DIAGRAM_LABELING","labels":[{"id":"l1","correctAnswer":"wheel"}]},
					{"id":"b9","type":"FLOW_CHART","steps":[{"id":"s1","correctAnswer":"mix"}]},
					{"id":"b10","type":"TABLE_COMPLETION","cells":[{"id":"c1","correctAnswer":"cell"}]},
					{"id":"b11","type":"CLASSIFICATION","items":[{"id":"i1","correctCategory":"B"}]},
					{"id":"b12","type":"MATCHING_FEATURES","features":[{"id":"f1","correctMatch":"M2"}]},
					{"id":"b13","type":"MULTI_MCQ","options":[{"id":"o1","isCorrect":true},{"id":"o2","isCorrect":true}]},
					{"id":"b14","type":"SINGLE_MCQ","options":[{"id":"s1","isCorrect":true}]}
				]
			}]
		}
	}`
	if err := validateObjectiveKeysForPublish(ProviderIELTS, content); err != nil {
		t.Fatalf("valid exam refused: %v", err)
	}
}

func TestPublishKeyGateOnlyAppliesToIELTS(t *testing.T) {
	content := `{"reading":{"passages":[{"blocks":[{"id":"b","type":"CLOZE","questions":[{"id":"q","prompt":"x"}]}]}]}}`
	if err := validateObjectiveKeysForPublish(ProviderSAT, content); err != nil {
		t.Fatalf("SAT publish was gated by the IELTS key check: %v", err)
	}
}
